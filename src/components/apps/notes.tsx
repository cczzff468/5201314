'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { localDB, genId, type NoteRecord } from '@/lib/ios/db';
import { selectResolvedTheme, useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import { useLocalToast, LocalToast } from '@/components/apps/page-toast';
import {
  BG_WARM,
  FOLDER_ALL,
  FOLDER_DEFAULT,
  FOLDER_TRASH,
  GOLD_DARK,
  GOLD_LIGHT,
  displayTitle,
  exportTxt,
  folderNameOf,
  isBlankNote,
  loadFolders,
  patchNote,
  saveFolders,
  type FolderInfo,
} from './notes/notes-shared';
import { FoldersPage, ListPage, SearchPage, TrashPage } from './notes/notes-pages';
import { MoveSheet, NewFolderSheet, NoteActionsSheet, TrashNoteSheet } from './notes/notes-sheets';
import { NoteEditor } from './notes/notes-editor';

/**
 * 备忘录 App（金色重构版）主编排：
 *
 * 9 个页面/状态：
 * 1. 文件夹（主页）        → FoldersPage
 * 2. 备忘录列表            → ListPage（按 folderId 过滤，'all' 聚合）
 * 3. 备忘录编辑            → NoteEditor
 * 4. 新建/重命名文件夹     → NewFolderSheet（抽屉）
 * 5. 备忘录操作            → NoteActionsSheet（抽屉）
 * 6. 移动到文件夹          → MoveSheet（抽屉）
 * 7. 批量选择              → ListPage selectMode
 * 8. 搜索备忘录            → SearchPage
 * 9. 最近删除              → TrashPage + TrashNoteSheet（恢复/永久删除）
 *
 * 数据：IndexedDB notes 表（content 为 HTML，600ms debounce 自动保存，旧数据向后兼容）；
 * 自定义文件夹存 idb-kv 'notes-folders'；删除 = deletedAt 标记进「最近删除」，恢复清标记，永久删除真删。
 */

type Page =
  | { kind: 'folders' }
  | { kind: 'list'; folderId: string }
  | { kind: 'search'; from: 'folders' | string }
  | { kind: 'trash' };

export default function NotesApp() {
  // 跟随应用内已解析主题选择金色深浅
  const theme = useSettings((s) => s.theme);
  const dark = selectResolvedTheme(theme, useSystemDark()) === 'dark';
  const gold = dark ? GOLD_DARK : GOLD_LIGHT;

  const [toast, showToast] = useLocalToast();

  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);

  // 路由
  const [page, setPage] = useState<Page>({ kind: 'folders' });
  // 编辑器态（active = 打开时的快照）
  const [active, setActive] = useState<NoteRecord | null>(null);
  const [focusOn, setFocusOn] = useState<'title' | 'body' | 'checklist' | null>(null);
  /** 编辑器返回目标（打开编辑器前的页面） */
  const returnPageRef = useRef<Page>({ kind: 'folders' });
  /** 本轮新建草稿 id（离开编辑器时空白未置顶 → 自动丢弃） */
  const draftIdRef = useRef<string | null>(null);

  // 搜索页关键词（保留在主编排，进编辑器再返回不丢）
  const [searchQuery, setSearchQuery] = useState('');

  // 抽屉态
  const [folderSheet, setFolderSheet] = useState<{ editing: FolderInfo | null } | null>(null);
  const [actionsNote, setActionsNote] = useState<NoteRecord | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [trashNote, setTrashNote] = useState<NoteRecord | null>(null);

  // ---------------- 数据加载 ----------------

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all = await localDB.getAll('notes');
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        // 幽灵空记录清扫（跳过回收站记录）：与编辑器空正文归一口径一致
        const kept = all.filter((n) => n.deletedAt !== undefined || !isBlankNote(n));
        if (kept.length !== all.length) {
          for (const n of all) {
            if (n.deletedAt === undefined && isBlankNote(n)) {
              void localDB.delete('notes', n.id).catch(() => undefined);
            }
          }
        }
        if (alive) setNotes(kept);
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setFolders(loadFolders());
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function reloadNotes() {
    try {
      const all = await localDB.getAll('notes');
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(all);
    } catch {
      /* 保持原列表 */
    }
  }

  const liveNotes = useMemo(
    () => notes.filter((n) => n.deletedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );
  const trashNotes = useMemo(
    () => notes.filter((n) => n.deletedAt !== undefined).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notes]
  );

  // ---------------- 记录变更（统一入口） ----------------

  /** 写入补丁后的记录并刷新（单条） */
  function putPatched(n: NoteRecord, patch: Parameters<typeof patchNote>[1], msg?: string) {
    void (async () => {
      try {
        await localDB.put('notes', patchNote(n, patch));
        await reloadNotes();
        if (msg) showToast(msg);
      } catch {
        /* 忽略写入异常 */
      }
    })();
  }

  // ---------------- 编辑器流转 ----------------

  function openNote(n: NoteRecord) {
    draftIdRef.current = null;
    returnPageRef.current = page;
    setActive(n);
    setFocusOn(null);
  }

  function createNote(folderId: string, withChecklist: boolean) {
    const now = Date.now();
    const rec: NoteRecord = {
      id: genId(),
      title: '',
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    if (folderId !== FOLDER_ALL) rec.folder = folderId;
    if (withChecklist) rec.checklist = [{ id: genId(), text: '', done: false }];
    draftIdRef.current = rec.id;
    returnPageRef.current = page.kind === 'list' ? page : { kind: 'list', folderId: FOLDER_ALL };
    setActive(rec);
    setFocusOn(withChecklist ? 'checklist' : 'title');
    void localDB.put('notes', rec).catch(() => undefined);
  }

  /** 回到来源页（完成/返回）：新建草稿若仍为空白未置顶 → 按 iOS 语义丢弃；重新加载 */
  function backFromEditor() {
    const draftId = draftIdRef.current;
    draftIdRef.current = null;
    setActive(null);
    setFocusOn(null);
    setPage(returnPageRef.current);
    void (async () => {
      if (draftId) {
        try {
          const rec = (await localDB.get('notes', draftId)) as NoteRecord | undefined;
          if (rec && rec.deletedAt === undefined && isBlankNote(rec)) await localDB.delete('notes', draftId);
        } catch {
          /* 丢弃失败不阻塞 */
        }
      }
      await reloadNotes();
    })();
  }

  // ---------------- 页面动作 ----------------

  function composeInCurrentFolder() {
    const folderId = page.kind === 'list' ? page.folderId : FOLDER_DEFAULT;
    createNote(folderId === FOLDER_TRASH ? FOLDER_DEFAULT : folderId, false);
  }

  function openSearchFrom(from: 'folders' | string) {
    setSearchQuery('');
    setPage({ kind: 'search', from });
  }

  function searchBack() {
    const p = page;
    if (p.kind === 'search') {
      setPage(p.from === 'folders' ? { kind: 'folders' } : { kind: 'list', folderId: p.from });
    } else {
      setPage({ kind: 'folders' });
    }
  }

  // 文件夹
  function submitFolder(name: string) {
    const editing = folderSheet?.editing ?? null;
    if (editing) {
      const next = folders.map((f) => (f.id === editing.id ? { ...f, name } : f));
      setFolders(next);
      saveFolders(next);
      showToast('文件夹已重命名');
    } else {
      const f: FolderInfo = { id: genId(), name, createdAt: Date.now() };
      const next = [...folders, f];
      setFolders(next);
      saveFolders(next);
      showToast(`已创建文件夹「${name}」`);
    }
    setFolderSheet(null);
  }

  function deleteFolder(f: FolderInfo) {
    void (async () => {
      try {
        // 文件夹内备忘录移回默认夹
        const inside = notes.filter((n) => n.deletedAt === undefined && (n.folder ?? FOLDER_DEFAULT) === f.id);
        for (const n of inside) {
          await localDB.put('notes', patchNote(n, { folder: FOLDER_DEFAULT }));
        }
      } catch {
        /* 单条失败继续删文件夹 */
      }
      const next = folders.filter((x) => x.id !== f.id);
      setFolders(next);
      saveFolders(next);
      await reloadNotes();
      showToast(`已删除文件夹「${f.name}」`);
    })();
  }

  // 备忘录动作（页5）
  function togglePinById(n: NoteRecord) {
    putPatched(n, { pinned: !(n.pinned === true) }, n.pinned ? '已取消置顶' : '已置顶');
  }

  function toggleLockById(n: NoteRecord) {
    putPatched(n, { locked: !(n.locked === true) }, n.locked ? '已解锁' : '已锁定');
  }

  /** 移动到文件夹（页6 确认；批量选择页7 复用） */
  function moveToFolder(ids: string[], target: string) {
    const targetId = target === FOLDER_ALL ? FOLDER_DEFAULT : target;
    void (async () => {
      try {
        for (const id of ids) {
          const n = notes.find((x) => x.id === id);
          if (!n || n.deletedAt !== undefined) continue;
          await localDB.put('notes', patchNote(n, { folder: targetId }));
        }
        await reloadNotes();
        showToast(`已移动到「${folderNameOf(targetId, folders)}」`);
      } catch {
        /* 忽略 */
      }
    })();
  }

  /** 删除（软删 → 最近删除） */
  function trashByIds(ids: string[]) {
    void (async () => {
      try {
        const now = Date.now();
        for (const id of ids) {
          const n = notes.find((x) => x.id === id);
          if (!n || n.deletedAt !== undefined) continue;
          await localDB.put('notes', patchNote(n, { deletedAt: now }));
        }
        await reloadNotes();
        showToast(ids.length > 1 ? `已删除 ${ids.length} 条备忘录` : '已移到最近删除');
      } catch {
        /* 忽略 */
      }
    })();
  }

  /** 恢复（清 deletedAt 标记） */
  function restoreByIds(ids: string[]) {
    void (async () => {
      try {
        for (const id of ids) {
          const n = notes.find((x) => x.id === id);
          if (!n || n.deletedAt === undefined) continue;
          await localDB.put('notes', patchNote(n, { deletedAt: null }));
        }
        await reloadNotes();
        showToast(ids.length > 1 ? `已恢复 ${ids.length} 条备忘录` : '已恢复备忘录');
      } catch {
        /* 忽略 */
      }
    })();
  }

  /** 永久删除（真删，二次确认） */
  function purgeByIds(ids: string[], confirmFirst: boolean) {
    const label = ids.length > 1 ? `${ids.length} 条备忘录` : `“${displayTitle(notes.find((n) => n.id === ids[0]) ?? { title: '备忘录' } as NoteRecord)}”`;
    if (confirmFirst && !window.confirm(`永久删除${label}？此操作不可撤销。`)) return;
    void (async () => {
      try {
        for (const id of ids) await localDB.delete('notes', id);
        await reloadNotes();
        showToast('已永久删除');
      } catch {
        /* 忽略 */
      }
    })();
  }

  // ---------------- 渲染 ----------------

  const goldVar = { '--notes-gold': gold, backgroundColor: dark ? undefined : BG_WARM } as CSSProperties;

  // 编辑器（全屏覆盖）
  if (active) {
    return (
      <div className="relative h-full w-full overflow-hidden" style={goldVar}>
        <NoteEditor
          note={active}
          folderName={folderNameOf(active.folder ?? FOLDER_DEFAULT, folders)}
          focusOn={focusOn}
          onDone={backFromEditor}
          onOpenCalendar={() => useUI.getState().switchToApp('calendar')}
        />
        <LocalToast msg={toast} />
      </div>
    );
  }

  const p = page;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
      style={goldVar}
    >
      {p.kind === 'folders' && (
        <FoldersPage
          folders={folders}
          liveNotes={liveNotes}
          trashCount={trashNotes.length}
          onOpenFolder={(id) => {
            if (id === FOLDER_TRASH) setPage({ kind: 'trash' });
            else setPage({ kind: 'list', folderId: id });
          }}
          onOpenSearch={() => openSearchFrom('folders')}
          onCompose={() => createNote(FOLDER_DEFAULT, false)}
          onNewFolder={() => setFolderSheet({ editing: null })}
          onDeleteFolder={deleteFolder}
          onRenameFolder={(f) => setFolderSheet({ editing: f })}
        />
      )}

      {p.kind === 'list' &&
        (() => {
          const folderId = p.folderId;
          const filtered = folderId === FOLDER_ALL ? liveNotes : liveNotes.filter((n) => (n.folder ?? FOLDER_DEFAULT) === folderId);
          return (
            <ListPage
              folderId={folderId}
              folderName={folderNameOf(folderId, folders)}
              notes={loaded ? filtered : []}
              folders={folders}
              onBackToFolders={() => setPage({ kind: 'folders' })}
              onOpenSearch={() => openSearchFrom(folderId)}
              onOpenNote={openNote}
              onNoteActions={(n) => setActionsNote(n)}
              onCompose={composeInCurrentFolder}
              onNewFolder={() => setFolderSheet({ editing: null })}
              onMoveSelected={(ids) => setMoveIds(ids)}
              onDeleteSelected={(ids) => trashByIds(ids)}
            />
          );
        })()}

      {p.kind === 'search' && (
        <SearchPage
          backLabel={p.from === 'folders' ? '文件夹' : folderNameOf(p.from, folders)}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          allNotes={liveNotes}
          folders={folders}
          onBack={searchBack}
          onOpenNote={openNote}
          onNoteActions={(n) => setActionsNote(n)}
        />
      )}

      {p.kind === 'trash' && (
        <TrashPage
          notes={loaded ? trashNotes : []}
          folders={folders}
          onBack={() => setPage({ kind: 'folders' })}
          onOpenTrashNote={(n) => setTrashNote(n)}
          onRestoreSelected={(ids) => restoreByIds(ids)}
          onPurgeSelected={(ids) => purgeByIds(ids, true)}
        />
      )}

      {/* 页4：新建/重命名文件夹 */}
      <NewFolderSheet
        open={folderSheet !== null}
        editing={folderSheet?.editing ?? null}
        onClose={() => setFolderSheet(null)}
        onSubmit={submitFolder}
      />

      {/* 页5：备忘录操作（长按卡片 / ⋯） */}
      <NoteActionsSheet
        open={actionsNote !== null}
        note={actionsNote}
        folders={folders}
        onClose={() => setActionsNote(null)}
        onTogglePin={(n) => {
          setActionsNote(null);
          togglePinById(n);
        }}
        onToggleLock={(n) => {
          setActionsNote(null);
          toggleLockById(n);
        }}
        onMove={(n) => {
          setActionsNote(null);
          setMoveIds([n.id]);
        }}
        onExport={(n) => {
          setActionsNote(null);
          exportTxt(n);
        }}
        onDelete={(n) => {
          setActionsNote(null);
          trashByIds([n.id]);
        }}
      />

      {/* 页6：移动到文件夹（单个/批量共用） */}
      <MoveSheet
        open={moveIds !== null}
        notes={moveIds ? notes.filter((n) => moveIds.includes(n.id)) : []}
        folders={folders}
        onClose={() => setMoveIds(null)}
        onMove={(target) => {
          const ids = moveIds ?? [];
          setMoveIds(null);
          if (ids.length > 0) moveToFolder(ids, target);
        }}
      />

      {/* 页9：最近删除卡片抽屉（恢复 / 永久删除） */}
      <TrashNoteSheet
        open={trashNote !== null}
        note={trashNote}
        onClose={() => setTrashNote(null)}
        onRestore={(n) => {
          setTrashNote(null);
          restoreByIds([n.id]);
        }}
        onPurge={(n) => {
          setTrashNote(null);
          purgeByIds([n.id], true);
        }}
      />

      <LocalToast msg={toast} />
    </div>
  );
}
