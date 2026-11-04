'use client';

/**
 * 备忘录 App（金色重构版）四个页面：
 * - FoldersPage 文件夹（页1）：大标题+右上⋯圆形按钮（菜单进编辑模式）、搜索、
 *   文件夹列表（金色文件夹线性图标+条数+>，最近删除红金垃圾桶）、底部工具栏
 * - ListPage 备忘录列表（页2）：置顶+时间分组卡片流；批量选择模式（页7）
 * - SearchPage 搜索备忘录（页8）：自动聚焦搜索框、找到 N 条、关键词高亮
 * - TrashPage 最近删除（页9）：灰色卡片 + 恢复/永久删除（30 天自动清理暂未实现，见 TODO）
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronRight,
  FolderClosed,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import type { NoteRecord } from '@/lib/ios/db';
import {
  BG_WARM,
  FOLDER_ALL,
  FOLDER_DEFAULT,
  FOLDER_TRASH,
  MUTED_META_CLS,
  WARM_RED,
  groupNotes,
  noteMatches,
  type FolderInfo,
} from './notes-shared';
import {
  BottomToolbar,
  EmptyHint,
  GoldMoreButton,
  GoldNavButton,
  GroupHeader,
  NoteCard,
  SearchBox,
  SelectToolbar,
  SheetCard,
  SheetShell,
} from './notes-ui';

/** 白色分组容器卡（用户反馈：素白面板，去掉灰色边框与阴影） */
const GROUP_CARD = 'overflow-hidden rounded-[14px] bg-white dark:bg-white/[0.06]';

/** 行间内缩分隔线（起始位置由调用方指定，与行内文字对齐） */
function RowDivider({ left }: { left: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-0 ${left} right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.06]`}
    />
  );
}

/** 页面公共外壳：三段式导航（金色文字按钮）+ 大标题 + 可滚动内容 */
function PageShell({
  navLeft,
  navRight,
  title,
  sub,
  children,
  onTitleClick,
}: {
  navLeft: ReactNode;
  navRight: ReactNode;
  title: string;
  sub?: string;
  children: ReactNode;
  onTitleClick?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-[46px] backdrop-blur-xl" style={{ backgroundColor: BG_WARM }}>
        <div className="flex h-12 items-center justify-between">
          <div className="flex min-w-[68px] items-center">{navLeft}</div>
          <div className="flex min-w-[68px] items-center justify-end">{navRight}</div>
        </div>
        <button
          type="button"
          onClick={onTitleClick}
          disabled={!onTitleClick}
          className="mt-0.5 block w-full text-left"
        >
          <div className="text-[30px] font-bold leading-tight tracking-tight text-foreground">{title}</div>
          {sub && <div className={`mt-0.5 text-[13px] ${MUTED_META_CLS}`}>{sub}</div>}
        </button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// ---------------- 页1：文件夹 ----------------

export function FoldersPage({
  folders,
  liveNotes,
  trashCount,
  onOpenFolder,
  onOpenSearch,
  onCompose,
  onNewFolder,
  onDeleteFolder,
  onRenameFolder,
}: {
  folders: FolderInfo[];
  liveNotes: NoteRecord[];
  trashCount: number;
  onOpenFolder: (id: string) => void;
  onOpenSearch: () => void;
  onCompose: () => void;
  onNewFolder: () => void;
  onDeleteFolder: (f: FolderInfo) => void;
  onRenameFolder: (f: FolderInfo) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuFolder, setMenuFolder] = useState<FolderInfo | null>(null);

  const countOf = (id: string) =>
    id === FOLDER_ALL ? liveNotes.length : liveNotes.filter((n) => (n.folder ?? FOLDER_DEFAULT) === id).length;

  /** 文件夹行（不含最近删除——设计稿中它是独立白卡） */
  const rows: { id: string; name: string; removable?: boolean }[] = [
    { id: FOLDER_ALL, name: '全部备忘录' },
    { id: FOLDER_DEFAULT, name: '备忘录' },
    ...folders.map((f) => ({ id: f.id, name: f.name, removable: true })),
  ];

  return (
    <>
      <PageShell
        navLeft={null}
        navRight={
          editMode ? (
            /* 编辑模式：右上「完成」退出（同 iOS 备忘录编辑态） */
            <GoldNavButton label="完成" onClick={() => setEditMode(false)} />
          ) : (
            /* 常态：右上金圈三点按钮（用户指定样式）→ 菜单进编辑模式 */
            <GoldMoreButton onClick={() => setMoreOpen(true)} />
          )
        }
        title="文件夹"
      >
        <div className="px-4 pb-[130px]">
          <div className="mt-1">
            <SearchBox tappable onTap={onOpenSearch} />
          </div>

          <div className={`mt-5 ${GROUP_CARD}`}>
            {rows.map((r, i) => {
              const count = countOf(r.id);
              const inner = (
                <>
                  {editMode && r.removable ? (
                    <button
                      type="button"
                      aria-label={`删除文件夹「${r.name}」`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const f = folders.find((x) => x.id === r.id);
                        if (f && window.confirm(`删除文件夹「${f.name}」？其中的备忘录将移回「备忘录」。`)) {
                          onDeleteFolder(f);
                        }
                      }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ff3b30] text-white transition-transform active:scale-90"
                    >
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M2 6h8" />
                      </svg>
                    </button>
                  ) : editMode ? (
                    /* 编辑模式下不可删的内置行保留同宽空位，与可删行对齐 */
                    <span className="w-6 shrink-0" />
                  ) : null}
                  {/* 常态无空位：图标紧贴卡片左缘（用户反馈「图标应该挨着边缘」）；实心金色文件夹 */}
                  <span className="flex shrink-0 items-center" style={{ color: 'var(--notes-gold)' }}>
                    <FolderClosed className="h-[21px] w-[21px]" fill="currentColor" strokeWidth={1.2} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[16px] text-foreground">{r.name}</span>
                  <span className={`shrink-0 text-[14px] ${MUTED_META_CLS}`}>{count}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c4bd]" strokeWidth={2.2} />
                </>
              );
              const rowCls = 'flex min-h-[52px] items-center gap-3 px-4 text-left';
              return (
                <div key={r.id} className="relative">
                  {/* 分隔线与文字起点对齐（px-4 16 + 图标 21 + gap 12 = 49） */}
                  {i > 0 && <RowDivider left="left-[49px]" />}
                  {editMode && r.removable ? (
                    <div className={rowCls}>{inner}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenFolder(r.id)}
                      className={`${rowCls} w-full transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]`}
                    >
                      {inner}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 最近删除：设计稿中独立于文件夹列表之外的白卡（金色垃圾桶线性图标） */}
          <div className={`mt-3.5 ${GROUP_CARD}`}>
            <button
              type="button"
              onClick={() => onOpenFolder(FOLDER_TRASH)}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              {/* 常态无空位：图标紧贴卡片左缘；金色垃圾桶线性图标 */}
              <span className="flex shrink-0 items-center" style={{ color: 'var(--notes-gold)' }}>
                <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[16px] text-foreground">最近删除</span>
              <span className={`shrink-0 text-[14px] ${MUTED_META_CLS}`}>{trashCount}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c4bd]" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </PageShell>

      <BottomToolbar onNewFolder={onNewFolder} onCompose={onCompose} />

      {/* ⋯ 菜单：编辑文件夹（进入批量删除/管理模式） */}
      <SheetShell open={moreOpen} onClose={() => setMoreOpen(false)} ariaLabel="更多操作">
        <SheetCard>
          <div className="rounded-[16px] bg-white py-1 shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setEditMode(true);
              }}
              className="flex h-[50px] w-full items-center justify-center text-[16px] transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              style={{ color: 'var(--notes-gold)' }}
            >
              编辑文件夹
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="mt-2 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-white text-[16px] font-semibold text-foreground shadow-[0_1px_3px_rgba(80,65,40,0.08)] ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.04] dark:bg-white/[0.1] dark:ring-white/[0.08]"
          >
            取消
          </button>
        </SheetCard>
      </SheetShell>

      {/* 长按自定义文件夹：重命名 / 删除 */}
      <SheetShell open={menuFolder !== null} onClose={() => setMenuFolder(null)} ariaLabel="文件夹操作">
        <SheetCard>
          <div className="rounded-[16px] bg-white py-1 shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
            {menuFolder && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const f = menuFolder;
                    setMenuFolder(null);
                    onRenameFolder(f);
                  }}
                  className="flex h-[50px] w-full items-center justify-center text-[16px] transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  style={{ color: 'var(--notes-gold)' }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const f = menuFolder;
                    setMenuFolder(null);
                    if (window.confirm(`删除文件夹「${f.name}」？其中的备忘录将移回「备忘录」。`)) {
                      onDeleteFolder(f);
                    }
                  }}
                  className="flex h-[50px] w-full items-center justify-center border-t border-black/[0.06] text-[16px] transition-colors active:bg-black/[0.04] dark:border-white/[0.07] dark:active:bg-white/[0.06]"
                  style={{ color: WARM_RED }}
                >
                  删除文件夹
                </button>
              </>
            )}
          </div>
        </SheetCard>
      </SheetShell>
    </>
  );
}

// ---------------- 页2：备忘录列表（含页7 批量选择） ----------------

export function ListPage({
  folderId,
  folderName,
  notes,
  folders,
  onBackToFolders,
  onOpenSearch,
  onOpenNote,
  onNoteActions,
  onCompose,
  onNewFolder,
  onMoveSelected,
  onDeleteSelected,
}: {
  folderId: string;
  folderName: string;
  notes: NoteRecord[];
  folders: FolderInfo[];
  onBackToFolders: () => void;
  onOpenSearch: () => void;
  onOpenNote: (n: NoteRecord) => void;
  onNoteActions: (n: NoteRecord) => void;
  onCompose: () => void;
  onNewFolder: () => void;
  onMoveSelected: (ids: string[]) => void;
  onDeleteSelected: (ids: string[]) => void;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);

  const groups = useMemo(() => groupNotes(notes), [notes]);
  const allIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const allSelected = selIds.size > 0 && selIds.size === allIds.length;

  function exitSelect() {
    setSelectMode(false);
    setSelIds(new Set());
  }

  function toggleAll() {
    setSelIds(allSelected ? new Set() : new Set(allIds));
  }

  function toggleOne(id: string) {
    setSelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageShell
        navLeft={
          <GoldNavButton
            label="文件夹"
            icon={<ChevronRight className="h-[18px] w-[18px] rotate-180" strokeWidth={2.4} />}
            onClick={() => {
              if (selectMode) exitSelect();
              onBackToFolders();
            }}
          />
        }
        navRight={
          selectMode ? (
            <GoldNavButton
              label="取消"
              onClick={exitSelect}
            />
          ) : (
            <GoldMoreButton onClick={() => setMoreOpen(true)} />
          )
        }
        title={selectMode ? `已选择 ${selIds.size} 条` : folderName}
      >
        <div className="px-4 pb-[130px]">
          <div className="mt-1">
            <SearchBox tappable onTap={onOpenSearch} />
          </div>

          {notes.length === 0 ? (
            <EmptyHint
              icon={<NotebookPen className="h-12 w-12" strokeWidth={1.1} />}
              title="没有备忘录"
              hint="轻点右下角按钮新建一条备忘录"
            />
          ) : selectMode ? (
            <div className="mt-3 flex flex-col gap-2">
              {notes.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  folders={folders}
                  variant="check"
                  checked={selIds.has(n.id)}
                  onToggleCheck={() => toggleOne(n.id)}
                />
              ))}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="mt-4">
                <GroupHeader label={g.label} pinned={g.pinnedSection} />
                {/* 设计稿：同组备忘录合入同一张白卡（iOS 内嵌分组），行间内缩分隔线 */}
                <div className={GROUP_CARD}>
                  {g.notes.map((n, i) => (
                    <div key={n.id} className="relative">
                      {i > 0 && <RowDivider left="left-4" />}
                      <NoteCard
                        note={n}
                        folders={folders}
                        variant="row"
                        onOpen={() => onOpenNote(n)}
                        onLongPress={() => onNoteActions(n)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </PageShell>

      {selectMode ? (
        <SelectToolbar
          gold="var(--notes-gold)"
          allSelected={allSelected}
          hasSelection={selIds.size > 0}
          variant="list"
          onToggleAll={toggleAll}
          onMoveOrRestore={() => {
            const ids = [...selIds];
            if (ids.length === 0) return;
            exitSelect();
            onMoveSelected(ids);
          }}
          onDelete={() => {
            const ids = [...selIds];
            if (ids.length === 0) return;
            exitSelect();
            onDeleteSelected(ids);
          }}
        />
      ) : (
        <BottomToolbar onNewFolder={onNewFolder} onCompose={onCompose} />
      )}

      {/* ⋯ 菜单：选择备忘录 / 新建文件夹 */}
      <ListMoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} onSelectMode={() => {
        setMoreOpen(false);
        setSelectMode(true);
      }} onNewFolder={() => {
        setMoreOpen(false);
        onNewFolder();
      }} />
    </>
  );
}

/** ⋯ 菜单（本地小组件，避免循环依赖 sheets 文件） */
function ListMoreMenu({
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
          <button
            type="button"
            onClick={onSelectMode}
            className="flex h-[50px] w-full items-center justify-center text-[16px] transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            style={{ color: 'var(--notes-gold)' }}
          >
            选择备忘录
          </button>
          <button
            type="button"
            onClick={onNewFolder}
            className="flex h-[50px] w-full items-center justify-center border-t border-black/[0.06] text-[16px] transition-colors active:bg-black/[0.04] dark:border-white/[0.07] dark:active:bg-white/[0.06]"
            style={{ color: 'var(--notes-gold)' }}
          >
            新建文件夹
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-white text-[16px] font-semibold text-foreground shadow-[0_1px_3px_rgba(80,65,40,0.08)] ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.04] dark:bg-white/[0.1] dark:ring-white/[0.08]"
        >
          取消
        </button>
      </SheetCard>
    </SheetShell>
  );
}

// ---------------- 页8：搜索备忘录 ----------------

export function SearchPage({
  backLabel,
  query,
  onQueryChange,
  allNotes,
  folders,
  onBack,
  onOpenNote,
  onNoteActions,
}: {
  backLabel: string;
  query: string;
  onQueryChange: (v: string) => void;
  allNotes: NoteRecord[];
  folders: FolderInfo[];
  onBack: () => void;
  onOpenNote: (n: NoteRecord) => void;
  onNoteActions: (n: NoteRecord) => void;
}) {
  const results = useMemo(() => {
    const q = query.trim();
    const list = q ? allNotes.filter((n) => noteMatches(n, q)) : allNotes;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allNotes, query]);

  return (
    <PageShell
      navLeft={
        <GoldNavButton
          label={backLabel}
          icon={<ChevronRight className="h-[18px] w-[18px] rotate-180" strokeWidth={2.4} />}
          onClick={onBack}
        />
      }
      navRight={<GoldNavButton label="取消" onClick={onBack} />}
      title="搜索"
    >
      <div className="px-4 pb-[40px]">
        <div className="mt-1">
          <SearchBox value={query} onChange={onQueryChange} onClear={() => onQueryChange('')} autoFocus />
        </div>

        {results.length === 0 ? (
          <EmptyHint
            icon={<NotebookPen className="h-12 w-12" strokeWidth={1.1} />}
            title="没有找到备忘录"
            hint="换个关键词试试"
          />
        ) : (
          <>
            <div className={`mb-2 mt-4 px-1 text-[13px] ${MUTED_META_CLS}`}>
              找到 {results.length} 条备忘录
            </div>
            <div className="flex flex-col gap-2">
              {results.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  folders={folders}
                  query={query}
                  onOpen={() => onOpenNote(n)}
                  onLongPress={() => onNoteActions(n)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

// ---------------- 页9：最近删除 ----------------

export function TrashPage({
  notes,
  folders,
  onBack,
  onOpenTrashNote,
  onRestoreSelected,
  onPurgeSelected,
}: {
  notes: NoteRecord[];
  folders: FolderInfo[];
  onBack: () => void;
  onOpenTrashNote: (n: NoteRecord) => void;
  onRestoreSelected: (ids: string[]) => void;
  onPurgeSelected: (ids: string[]) => void;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const allIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const allSelected = selIds.size > 0 && selIds.size === allIds.length;

  // TODO（30 天自动清理）：deletedAt 超过 30 天的备忘录应在启动时自动永久删除，暂未实现。

  function exitSelect() {
    setSelectMode(false);
    setSelIds(new Set());
  }

  function toggleOne(id: string) {
    setSelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageShell
        navLeft={
          <GoldNavButton
            label="文件夹"
            icon={<ChevronRight className="h-[18px] w-[18px] rotate-180" strokeWidth={2.4} />}
            onClick={() => {
              if (selectMode) exitSelect();
              onBack();
            }}
          />
        }
        navRight={
          <GoldNavButton
            label={selectMode ? '取消' : '选择'}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          />
        }
        title="最近删除"
        sub={selectMode ? `已选择 ${selIds.size} 条` : '删除的备忘录可在这里恢复。'}
      >
        <div className="px-4 pb-[130px]">
          {notes.length === 0 ? (
            <EmptyHint
              icon={<Trash2 className="h-12 w-12" strokeWidth={1.1} />}
              title="最近删除为空"
              hint="删除的备忘录会先放在这里"
            />
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {notes.map((n) =>
                selectMode ? (
                  <NoteCard
                    key={n.id}
                    note={n}
                    folders={folders}
                    variant="check"
                    checked={selIds.has(n.id)}
                    onToggleCheck={() => toggleOne(n.id)}
                  />
                ) : (
                  <NoteCard
                    key={n.id}
                    note={n}
                    folders={folders}
                    variant="trash"
                    onOpen={() => onOpenTrashNote(n)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </PageShell>

      {selectMode && (
        <SelectToolbar
          gold="var(--notes-gold)"
          allSelected={allSelected}
          hasSelection={selIds.size > 0}
          variant="trash"
          onToggleAll={() => setSelIds(allSelected ? new Set() : new Set(allIds))}
          onMoveOrRestore={() => {
            const ids = [...selIds];
            if (ids.length === 0) return;
            exitSelect();
            onRestoreSelected(ids);
          }}
          onDelete={() => {
            const ids = [...selIds];
            if (ids.length === 0) return;
            exitSelect();
            onPurgeSelected(ids);
          }}
        />
      )}
    </>
  );
}
