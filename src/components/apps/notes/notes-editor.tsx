'use client';

/**
 * 备忘录编辑器（金色重构版，页3）：
 * - 导航：< 文件夹名 + 撤销/重做 + 完成（金色）
 * - 时间行（2026年10月23日 09:10）+ 大字标题 + 富文本正文（contentEditable HTML）
 * - 结构化清单「今天的重点」：金色勾选圆列表，可增删项/勾选/回车续项
 * - 日历关联胶囊：📅 10月23日，星期五（linkDate/linkedEventId），点按跳日历 App；
 *   工具栏 📅 打开关联抽屉（选日期 / 关联到日历日程）
 * - 底部工具栏 5 个金色图标：Aa（格式：B/I/U/H1/H2/正文）/ ☑（加清单项）/ 📅（日历关联）/
 *   🔍（正文内查找，高亮 + 上下跳转）/ 😊（插入表情）
 * - 撤销/重做：编辑器级快照栈（标题+正文HTML+清单），600ms 自动保存时入栈
 * - 持久化：IndexedDB notes 表，600ms debounce，保留 folder/pinned/locked/category 等既有字段
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Bold,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Italic,
  Link2,
  Lock,
  Plus,
  Redo2,
  Search,
  Smile,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
import { localDB, genId, type CalendarEventRecord, type NoteChecklistItem, type NoteRecord } from '@/lib/ios/db';
import { dayStr, focusEnd, formatFull, formatLinkDate, htmlToText } from './notes-shared';
import { SheetCard, SheetShell } from './notes-ui';

/** 编辑器快照（撤销/重做栈单元） */
interface EditorSnapshot {
  title: string;
  html: string;
  checklist: NoteChecklistItem[];
}

/** 常用表情（😊 工具按钮插入用） */
const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜',
  '🤗', '🤔', '😎', '🥳', '😴', '🥺', '😭', '😤',
  '👍', '👏', '🙏', '💪', '🤝', '✌️', '🫶', '👋',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '✨', '🌟',
  '🎉', '🎊', '🎁', '🍰', '☕', '🍎', '🍜', '🍳',
  '📖', '📝', '📌', '✅', '⭐', '🔥', '💡', '🎵',
];

/** 查找高亮标记属性（还原原文时识别用） */
const FIND_ATTR = 'data-nfind';
const FIND_MARK_STYLE = 'rgba(204,174,84,0.32)';
const FIND_ACTIVE_STYLE = 'rgba(204,174,84,0.95)';

export function NoteEditor({
  note,
  folderName,
  focusOn,
  onDone,
  onOpenCalendar,
}: {
  /** 打开时的快照；编辑器内部独立保存，不经 props 回流 */
  note: NoteRecord;
  folderName: string;
  focusOn: 'title' | 'body' | 'checklist' | null;
  onDone: () => void;
  /** 点击日历胶囊：跳日历 App */
  onOpenCalendar: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? '');
  const [savedAt, setSavedAt] = useState(note.updatedAt);
  const [checklist, setChecklist] = useState<NoteChecklistItem[]>(note.checklist ?? []);
  const [linkDate, setLinkDate] = useState(note.linkDate ?? '');
  const [linkedEventId, setLinkedEventId] = useState(note.linkedEventId ?? '');
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);

  const locked = note.locked === true;
  const [unlocked, setUnlocked] = useState(!locked);

  // 工具弹层
  const [showAa, setShowAa] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showLink, setShowLink] = useState(false);
  // 正文内查找：q=关键词 idx=当前第几个 count=命中总数（null = 关闭）
  const [find, setFind] = useState<{ q: string; idx: number; count: number } | null>(null);

  const [bodyEmpty, setBodyEmpty] = useState(() => htmlToText(note.content).trim() === '');

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<NoteRecord | null>(null);
  const timerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 查找模式的原始 HTML（关闭时还原，编辑暂停防污染） */
  const originalHtmlRef = useRef<string | null>(null);
  /** 清单项输入框 refs（回车续项/删除聚焦用） */
  const itemRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  /** 事件处理器里的最新值（避免闭包过期） */
  const latestRef = useRef({
    title: note.title ?? '',
    checklist: (note.checklist ?? []) as NoteChecklistItem[],
    linkDate: note.linkDate ?? '',
    linkedEventId: note.linkedEventId ?? '',
  });
  /** 撤销/重做栈 */
  const historyRef = useRef<{ list: EditorSnapshot[]; idx: number }>({ list: [], idx: -1 });
  const [histPos, setHistPos] = useState({ canUndo: false, canRedo: false });

  // 挂载：注入初始 HTML + 按来源聚焦 + 载入日历日程（关联抽屉用）+ 撤销栈初始快照；卸载冲刷未落盘修改
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.innerHTML = note.content;
    historyRef.current = {
      list: [
        {
          title: note.title ?? '',
          html: note.content,
          checklist: note.checklist ?? [],
        },
      ],
      idx: 0,
    };

    let focusTimer: number | null = null;
    if (focusOn === 'title') {
      titleRef.current?.focus();
    } else if (focusOn === 'body' && el) {
      focusEnd(el);
    } else if (focusOn === 'checklist') {
      focusTimer = window.setTimeout(() => {
        const first = latestRef.current.checklist[0];
        if (first) itemRefs.current.get(first.id)?.focus();
      }, 80);
    }

    void (async () => {
      try {
        const all = await localDB.getAll('events');
        all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        setEvents(all.filter((e) => e.date >= dayStr()));
      } catch {
        /* 日程读不到时仅影响关联列表 */
      }
    })();

    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const rec = pendingRef.current;
      pendingRef.current = null;
      if (rec) void localDB.put('notes', rec).catch(() => undefined);
    };
  }, []);

  // ---------------- 保存（600ms debounce）+ 撤销栈 ----------------

  function buildRec(): NoteRecord {
    const l = latestRef.current;
    const rec: NoteRecord = {
      id: note.id,
      title: l.title.trim(),
      content: bodyRef.current?.innerHTML ?? '',
      createdAt: note.createdAt,
      updatedAt: Date.now(),
    };
    if (note.pinned) rec.pinned = true;
    if (note.locked) rec.locked = true;
    if (note.folder) rec.folder = note.folder;
    if (note.category) rec.category = note.category; // 旧字段保留不丢
    if (l.checklist.length > 0) rec.checklist = l.checklist;
    if (l.linkDate) rec.linkDate = l.linkDate;
    if (l.linkedEventId) rec.linkedEventId = l.linkedEventId;
    return rec;
  }

  function pushHistory() {
    const snap: EditorSnapshot = {
      title: latestRef.current.title,
      html: bodyRef.current?.innerHTML ?? '',
      checklist: latestRef.current.checklist,
    };
    const h = historyRef.current;
    const cur = h.list[h.idx];
    if (
      cur &&
      cur.title === snap.title &&
      cur.html === snap.html &&
      JSON.stringify(cur.checklist) === JSON.stringify(snap.checklist)
    ) {
      return;
    }
    h.list = h.list.slice(0, h.idx + 1);
    h.list.push(snap);
    if (h.list.length > 80) h.list.shift();
    h.idx = h.list.length - 1;
    setHistPos({ canUndo: h.idx > 0, canRedo: false });
  }

  function scheduleSave() {
    pendingRef.current = buildRec();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 600);
  }

  async function flushSave() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pushHistory();
    const rec = pendingRef.current;
    if (!rec) return;
    pendingRef.current = null;
    try {
      await localDB.put('notes', rec);
      setSavedAt(rec.updatedAt);
    } catch {
      /* 保存失败时静默，避免打断输入 */
    }
  }

  /** 撤销/重做应用快照：直接落库（不入栈） */
  function applySnapshot(snap: EditorSnapshot) {
    latestRef.current = {
      title: snap.title,
      checklist: snap.checklist,
      linkDate: latestRef.current.linkDate,
      linkedEventId: latestRef.current.linkedEventId,
    };
    setTitle(snap.title);
    setChecklist(snap.checklist);
    const el = bodyRef.current;
    if (el) {
      el.innerHTML = snap.html;
      originalHtmlRef.current = el.innerHTML;
    }
    setBodyEmpty(htmlToText(snap.html).trim() === '');
    const rec = buildRec();
    pendingRef.current = null;
    void localDB.put('notes', rec).catch(() => undefined);
    setSavedAt(rec.updatedAt);
  }

  function undo() {
    const h = historyRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    applySnapshot(h.list[h.idx]);
    setHistPos({ canUndo: h.idx > 0, canRedo: h.idx < h.list.length - 1 });
  }

  function redo() {
    const h = historyRef.current;
    if (h.idx >= h.list.length - 1) return;
    h.idx += 1;
    applySnapshot(h.list[h.idx]);
    setHistPos({ canUndo: h.idx > 0, canRedo: h.idx < h.list.length - 1 });
  }

  // ---------------- 输入处理 ----------------

  function handleTitle(v: string) {
    latestRef.current.title = v;
    setTitle(v);
    scheduleSave();
  }

  function handleBodyInput() {
    const el = bodyRef.current;
    if (!el) return;
    const html = el.innerHTML;
    if (html !== '' && htmlToText(html).trim() === '' && !/<(img|a)\b/i.test(html)) {
      el.innerHTML = '';
    }
    setBodyEmpty(el.innerHTML === '');
    scheduleSave();
  }

  /** 格式命令：先护住焦点再执行，随后同步空态并入队保存 */
  function exec(cmd: string, value?: string) {
    if (locked && !unlocked) return;
    bodyRef.current?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* 忽略不支持的命令 */
    }
    handleBodyInput();
  }

  function handleDone() {
    void (async () => {
      await flushSave();
      onDone();
    })();
  }

  // ---------------- 清单 ----------------

  function setChecklistSync(next: NoteChecklistItem[]) {
    latestRef.current.checklist = next;
    setChecklist(next);
    scheduleSave();
  }

  function addChecklistItem(afterId?: string) {
    const item: NoteChecklistItem = { id: genId(), text: '', done: false };
    const next = [...latestRef.current.checklist];
    const at = afterId ? next.findIndex((i) => i.id === afterId) + 1 : next.length;
    next.splice(at, 0, item);
    setChecklistSync(next);
    window.setTimeout(() => itemRefs.current.get(item.id)?.focus(), 40);
  }

  function updateChecklistText(id: string, text: string) {
    setChecklistSync(latestRef.current.checklist.map((i) => (i.id === id ? { ...i, text } : i)));
  }

  function toggleChecklistItem(id: string) {
    setChecklistSync(latestRef.current.checklist.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }

  function removeChecklistItem(id: string) {
    const list = latestRef.current.checklist;
    const at = list.findIndex((i) => i.id === id);
    const next = list.filter((i) => i.id !== id);
    setChecklistSync(next);
    const focusTarget = next[Math.min(at, next.length - 1)];
    if (focusTarget) window.setTimeout(() => itemRefs.current.get(focusTarget.id)?.focus(), 40);
  }

  // ---------------- 日历关联 ----------------

  const linkedEvent = useMemo(
    () => events.find((e) => e.id === linkedEventId) ?? null,
    [events, linkedEventId]
  );

  function setLinkDateOnly(d: string) {
    latestRef.current.linkDate = d;
    latestRef.current.linkedEventId = '';
    setLinkDate(d);
    setLinkedEventId('');
    scheduleSave();
  }

  function setLinkEvent(ev: CalendarEventRecord) {
    latestRef.current.linkDate = ev.date;
    latestRef.current.linkedEventId = ev.id;
    setLinkDate(ev.date);
    setLinkedEventId(ev.id);
    scheduleSave();
  }

  function clearLink() {
    latestRef.current.linkDate = '';
    latestRef.current.linkedEventId = '';
    setLinkDate('');
    setLinkedEventId('');
    scheduleSave();
  }

  /** 胶囊文案：关联日程 → 「日程名 · 10月23日」；仅日期 → 「10月23日，星期五」 */
  const capsuleText = linkedEvent
    ? `${linkedEvent.title || '日程'} · ${formatLinkDate(linkedEvent.date || linkDate)}`
    : formatLinkDate(linkDate);

  // ---------------- 正文内查找 ----------------

  function openFind() {
    const el = bodyRef.current;
    if (!el) return;
    originalHtmlRef.current = el.innerHTML;
    setShowAa(false);
    setShowEmoji(false);
    setFind({ q: '', idx: 0, count: 0 });
  }

  function closeFind() {
    const el = bodyRef.current;
    if (el && originalHtmlRef.current !== null) el.innerHTML = originalHtmlRef.current;
    originalHtmlRef.current = null;
    setFind(null);
  }

  /** 查找：还原原文后逐文本节点包 mark（大小写不敏感） */
  function runFind(q: string) {
    const el = bodyRef.current;
    if (!el) return;
    if (originalHtmlRef.current !== null) el.innerHTML = originalHtmlRef.current;
    const query = q.trim().toLowerCase();
    if (!query) {
      setFind({ q, idx: 0, count: 0 });
      return;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    let count = 0;
    for (const node of nodes) {
      const text = node.nodeValue ?? '';
      const low = text.toLowerCase();
      if (!low.includes(query)) continue;
      const frag = document.createDocumentFragment();
      let i = 0;
      for (;;) {
        const idx = low.indexOf(query, i);
        if (idx === -1) {
          if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
          break;
        }
        if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement('mark');
        mark.setAttribute(FIND_ATTR, '');
        mark.style.backgroundColor = FIND_MARK_STYLE;
        mark.style.borderRadius = '3px';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        count += 1;
        i = idx + query.length;
      }
      node.parentNode?.replaceChild(frag, node);
    }
    setFind({ q, idx: 0, count });
  }

  // 查找位置变化：高亮当前命中 + 滚动到可见
  useEffect(() => {
    if (!find) return;
    const el = bodyRef.current;
    if (!el) return;
    const marks = el.querySelectorAll(`mark[${FIND_ATTR}]`);
    marks.forEach((m, i) => {
      (m as HTMLElement).style.backgroundColor = i === find.idx ? FIND_ACTIVE_STYLE : FIND_MARK_STYLE;
      (m as HTMLElement).style.color = i === find.idx ? '#fff' : 'inherit';
    });
    const active = marks[find.idx] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [find]);

  function stepFind(dir: 1 | -1) {
    if (!find || find.count === 0) return;
    const idx = (find.idx + dir + find.count) % find.count;
    setFind({ ...find, idx });
  }

  // ---------------- 渲染 ----------------

  const goldStyle = { color: 'var(--notes-gold)' } as CSSProperties;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F3F2F8] text-foreground dark:bg-background">
      {/* 顶部导航：< 文件夹名 + 撤销/重做 + 完成 */}
      <div className="shrink-0 bg-[#F3F2F8]/80 pt-[54px] backdrop-blur-xl dark:bg-background/80">
        <div className="flex h-11 items-center justify-between px-4">
          <button
            type="button"
            onClick={handleDone}
            aria-label="返回备忘录列表"
            className="-ml-1 flex items-center transition-opacity active:opacity-50"
            style={goldStyle}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
            <span>{folderName || '备忘录'}</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!histPos.canUndo}
              aria-label="撤销"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-opacity active:opacity-60 ${
                histPos.canUndo ? '' : 'opacity-30'
              }`}
              style={goldStyle}
            >
              <Undo2 className="h-[19px] w-[19px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!histPos.canRedo}
              aria-label="重做"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-opacity active:opacity-60 ${
                histPos.canRedo ? '' : 'opacity-30'
              }`}
              style={goldStyle}
            >
              <Redo2 className="h-[19px] w-[19px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="ml-1.5 text-[16px] font-medium transition-opacity active:opacity-50"
              style={goldStyle}
            >
              完成
            </button>
          </div>
        </div>
      </div>

      {/* 查找条（🔍 打开）：关键词 + 命中计数 + 上下跳转 + 关闭 */}
      {find !== null && (
        <div className="shrink-0 border-b border-black/[0.05] bg-[#F3F2F8]/90 px-4 py-2 backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/90">
          <div className="flex items-center gap-2">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-[10px] bg-[#E9E8ED] px-3 dark:bg-white/[0.09]">
              <Search className="h-4 w-4 shrink-0 text-[#b8b2aa]" strokeWidth={2.2} />
              <input
                value={find.q}
                onChange={(e) => runFind(e.target.value)}
                placeholder="在正文中查找"
                aria-label="在正文中查找"
                autoFocus
                className="h-full w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-[#b8b2aa]"
              />
            </div>
            <span className="min-w-[44px] text-center text-[13px] text-[#8e8880] dark:text-[#a8a29a]">
              {find.count > 0 ? `${find.idx + 1}/${find.count}` : '0 个'}
            </span>
            <button
              type="button"
              onClick={() => stepFind(-1)}
              disabled={find.count === 0}
              aria-label="上一个"
              className={`rotate-90 text-[#8e8880] dark:text-[#a8a29a] ${find.count === 0 ? 'opacity-35' : ''}`}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => stepFind(1)}
              disabled={find.count === 0}
              aria-label="下一个"
              className={`-rotate-90 text-[#8e8880] dark:text-[#a8a29a] ${find.count === 0 ? 'opacity-35' : ''}`}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={closeFind}
              aria-label="关闭查找"
              className="text-[#8e8880] dark:text-[#a8a29a]"
            >
              <X className="h-5 w-5" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div ref={scrollRef} className="no-scrollbar flex-1 overflow-y-auto">
        <div className="px-5 pb-[150px] pt-2">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => handleTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const el = bodyRef.current;
                if (el) focusEnd(el);
              }
            }}
            placeholder="标题"
            aria-label="备忘录标题"
            spellCheck={false}
            disabled={locked && !unlocked}
            className="w-full border-none bg-transparent text-[24px] font-bold leading-snug text-foreground outline-none placeholder:text-[#b8b2aa]/60"
          />
          <div className="mt-1 text-[12px] text-[#b8b2aa] dark:text-[#77716b]">{formatFull(savedAt)}</div>

          <div className="mb-3 mt-3 border-t border-border/60" />

          {/* 富文本正文（锁定未解锁时遮罩；查找模式暂停编辑防高亮标记落库） */}
          <div className="relative">
            {bodyEmpty && find === null && unlocked && (
              <div className="pointer-events-none absolute inset-x-0 top-0 text-[17px] leading-[1.6] text-[#b8b2aa]/70">
                输入正文…
              </div>
            )}
            <div
              ref={bodyRef}
              contentEditable={unlocked && find === null}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="备忘录正文"
              spellCheck={false}
              onInput={handleBodyInput}
              onMouseDown={() => {
                setShowAa(false);
                setShowEmoji(false);
              }}
              className="min-h-[160px] break-words text-[17px] leading-[1.6] text-foreground outline-none"
            />
            {locked && !unlocked && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[12px] bg-[#F3F2F8]/85 backdrop-blur-sm dark:bg-background/85">
                <Lock className="h-8 w-8" strokeWidth={1.6} style={goldStyle} />
                <div className="text-[15px] text-[#8e8880] dark:text-[#a8a29a]">此备忘录已锁定</div>
                <button
                  type="button"
                  onClick={() => setUnlocked(true)}
                  className="rounded-full px-5 py-1.5 text-[14px] font-medium text-white shadow-sm transition active:scale-95"
                  style={{ backgroundColor: 'var(--notes-gold)' }}
                >
                  解锁查看
                </button>
              </div>
            )}
          </div>

          {/* 结构化清单：今天的重点（金色勾选圆列表） */}
          {checklist.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[15px] font-semibold text-foreground">今天的重点</div>
              <div className="flex flex-col">
                {checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 py-[5px]">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={item.done}
                      aria-label={item.done ? '取消勾选' : '勾选'}
                      onClick={() => toggleChecklistItem(item.id)}
                      className="flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-transform active:scale-90"
                      style={
                        item.done
                          ? { backgroundColor: 'var(--notes-gold)', borderColor: 'var(--notes-gold)' }
                          : { borderColor: 'rgba(204,174,84,0.6)' }
                      }
                    >
                      {item.done && (
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12.5l5 5L20 6.5" />
                        </svg>
                      )}
                    </button>
                    <input
                      ref={(el) => {
                        if (el) itemRefs.current.set(item.id, el);
                        else itemRefs.current.delete(item.id);
                      }}
                      value={item.text}
                      onChange={(e) => updateChecklistText(item.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addChecklistItem(item.id);
                        } else if (e.key === 'Backspace' && item.text === '') {
                          e.preventDefault();
                          removeChecklistItem(item.id);
                        }
                      }}
                      placeholder="清单项"
                      aria-label="清单项"
                      spellCheck={false}
                      className={`h-7 min-w-0 flex-1 border-none bg-transparent text-[16px] outline-none placeholder:text-[#b8b2aa]/60 ${
                        item.done ? 'text-[#b8b2aa] dark:text-[#77716b]' : 'text-foreground'
                      }`}
                    />
                    <button
                      type="button"
                      aria-label="删除清单项"
                      onClick={() => removeChecklistItem(item.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#c9c4bd] transition-colors active:text-[#c25e4c]"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addChecklistItem()}
                  className="mt-1 flex items-center gap-1.5 py-1 text-[14px] text-[#8e8880] transition-opacity active:opacity-60 dark:text-[#a8a29a]"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.2} />
                  <span>添加项目</span>
                </button>
              </div>
            </div>
          )}

          {/* 日历关联胶囊：📅 10月23日，星期五 > → 点按跳日历 App（设计稿浅黄底金描胶囊） */}
          {capsuleText && (
            <button
              type="button"
              onClick={onOpenCalendar}
              aria-label={`打开日历查看 ${capsuleText}`}
              className="mt-5 flex items-center gap-1.5 rounded-[10px] px-3.5 py-[8px] text-[13px] font-medium transition-transform active:scale-[0.97]"
              style={{ backgroundColor: 'rgba(224,182,50,0.2)', color: 'var(--notes-gold)' }}
            >
              <CalendarDays className="h-[15px] w-[15px]" strokeWidth={2} />
              <span className="max-w-[240px] truncate">{capsuleText}</span>
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>

      {/* Aa 格式弹层（加粗/斜体/下划线/标题简单档） */}
      {showAa && (
        <div className="absolute bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-[16px] bg-white/90 px-2.5 py-2 shadow-[0_8px_28px_rgba(17,24,39,0.12)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#2a2a2c]/90 dark:ring-white/[0.1]">
            <FmtBtn label="粗体" onClick={() => exec('bold')}>
              <Bold className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </FmtBtn>
            <FmtBtn label="斜体" onClick={() => exec('italic')}>
              <Italic className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </FmtBtn>
            <FmtBtn label="下划线" onClick={() => exec('underline')}>
              <UnderlineIcon className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </FmtBtn>
            <span className="mx-0.5 h-5 w-px bg-black/10 dark:bg-white/15" />
            <FmtBtn label="标题 1" onClick={() => exec('formatBlock', 'H1')}>
              <span className="text-[13px] font-bold leading-none">H1</span>
            </FmtBtn>
            <FmtBtn label="标题 2" onClick={() => exec('formatBlock', 'H2')}>
              <span className="text-[13px] font-bold leading-none">H2</span>
            </FmtBtn>
            <FmtBtn label="正文" onClick={() => exec('formatBlock', 'P')}>
              <span className="text-[13px] leading-none">正文</span>
            </FmtBtn>
          </div>
        </div>
      )}

      {/* 表情弹层（点选插入正文） */}
      {showEmoji && (
        <div className="absolute bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2">
          <div className="grid w-[300px] grid-cols-8 gap-1 rounded-[16px] bg-white/90 p-3 shadow-[0_8px_28px_rgba(17,24,39,0.12)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#2a2a2c]/90 dark:ring-white/[0.1]">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`插入表情 ${e}`}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => exec('insertHTML', e)}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[19px] transition-colors active:bg-black/[0.06] dark:active:bg-white/10"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 底部工具栏：Aa / ☑ / 📅 / 🔍 / 😊 */}
      <div className="absolute inset-x-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-30">
        <div className="flex h-[58px] items-center justify-between rounded-[18px] bg-white/75 px-4 shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.08] dark:ring-white/[0.09]">
          <ToolBtn
            label="格式"
            active={showAa}
            onClick={() => {
              setShowAa((v) => !v);
              setShowEmoji(false);
            }}
          >
            <span className="text-[17px] font-semibold leading-none" style={{ fontFamily: 'Georgia, serif' }}>
              Aa
            </span>
          </ToolBtn>
          <ToolBtn
            label="添加清单项"
            onClick={() => {
              setShowAa(false);
              setShowEmoji(false);
              addChecklistItem();
            }}
          >
            <CircleCheck className="h-[22px] w-[22px]" strokeWidth={1.9} />
          </ToolBtn>
          <ToolBtn
            label="日历关联"
            active={showLink}
            onClick={() => {
              setShowAa(false);
              setShowEmoji(false);
              setShowLink(true);
            }}
          >
            <CalendarDays className="h-[22px] w-[22px]" strokeWidth={1.9} />
          </ToolBtn>
          <ToolBtn label="查找" active={find !== null} onClick={openFind}>
            <Search className="h-[21px] w-[21px]" strokeWidth={1.9} />
          </ToolBtn>
          <ToolBtn
            label="插入表情"
            active={showEmoji}
            onClick={() => {
              setShowAa(false);
              setShowEmoji((v) => !v);
            }}
          >
            <Smile className="h-[22px] w-[22px]" strokeWidth={1.9} />
          </ToolBtn>
        </div>
      </div>

      {/* 日历关联抽屉：选日期 / 关联到日程 / 取消关联 */}
      <SheetShell open={showLink} onClose={() => setShowLink(false)} ariaLabel="日历关联">
        <SheetCard>
          <div className="rounded-[16px] bg-white shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
            <div className="border-b border-black/[0.06] py-1 dark:border-white/[0.07]">
              {capsuleText && (
                <SheetRowLike
                  icon={<Link2 className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  label="取消关联"
                  sub={capsuleText}
                  onClick={clearLink}
                />
              )}
              <div className="flex h-[50px] items-center gap-3 px-4 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-black/[0.06] dark:[&:not(:first-child)]:border-white/[0.07]">
                <CalendarDays className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} style={goldStyle} />
                <span className="text-[15.5px] text-foreground">关联到某天</span>
                <input
                  type="date"
                  value={linkDate || dayStr()}
                  onChange={(e) => {
                    if (e.target.value) setLinkDateOnly(e.target.value);
                  }}
                  aria-label="选择关联日期"
                  className="ml-auto rounded-[8px] bg-[#E9E8ED] px-2 py-1 text-[13px] text-foreground outline-none dark:bg-white/[0.09]"
                />
              </div>
            </div>
            <div className="py-1">
              <div className="px-4 pb-1 pt-2 text-[12px] text-[#b8b2aa] dark:text-[#77716b]">
                关联到日程（日历 App）
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {events.length === 0 ? (
                  <div className="px-4 py-4 text-[14px] text-[#8e8880] dark:text-[#a8a29a]">暂无即将到来的日程</div>
                ) : (
                  events.slice(0, 20).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setLinkEvent(ev)}
                      className="flex h-[46px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-black/[0.06] dark:[&:not(:first-child)]:border-white/[0.07]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] text-foreground">{ev.title || '日程'}</div>
                      </div>
                      <div className="shrink-0 text-[12px] text-[#b8b2aa] dark:text-[#77716b]">
                        {formatLinkDate(ev.date)}
                        {ev.startTime ? ` ${ev.startTime}` : ''}
                      </div>
                      {linkedEventId === ev.id && (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: 'var(--notes-gold)' }} />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowLink(false)}
            className="mt-2 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-white text-[16px] font-semibold text-foreground shadow-[0_1px_3px_rgba(80,65,40,0.08)] ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.04] dark:bg-white/[0.1] dark:ring-white/[0.08]"
          >
            完成
          </button>
        </SheetCard>
      </SheetShell>
    </div>
  );
}

/** 工具栏按钮（金色） */
function ToolBtn({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] transition-all active:scale-90 ${
        active ? 'bg-[rgba(224,182,50,0.2)]' : ''
      }`}
      style={{ color: 'var(--notes-gold)' }}
    >
      {children}
    </button>
  );
}

/** Aa 弹层按钮 */
function FmtBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors active:bg-black/[0.06] dark:active:bg-white/10"
      style={{ color: 'var(--notes-gold)' }}
    >
      {children}
    </button>
  );
}

/** 关联抽屉行（图标 + 主文案 + 副文案） */
function SheetRowLike({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[50px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className="shrink-0" style={{ color: 'var(--notes-gold)' }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] text-foreground">{label}</span>
        {sub && (
          <span className="block truncate text-[12px] text-[#b8b2aa] dark:text-[#77716b]">{sub}</span>
        )}
      </span>
    </button>
  );
}
