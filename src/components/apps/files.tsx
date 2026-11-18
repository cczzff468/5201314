'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ReadTagsOptions } from 'jsmediatags';
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Download,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Mic,
  Music2,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  localDB,
  genId,
  formatDuration,
  type PhotoRecord,
  type RecordingRecord,
  type MusicRecord,
  type NoteRecord,
  type CalendarEventRecord,
  type ReminderRecord,
} from '@/lib/ios/db';
import { IOSNavBar, IOSBackButton, IOSTextButton } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import WheelDatePicker from './wheel-date-picker';

/**
 * 文件 App：
 * - 根级页：我的 iPhone / 存储空间卡（navigator.storage.estimate）/ 6 个资料库统计
 * - 二级页：各资料库条目列表（照片缩略图+大图预览、录音/音乐点按播放、备忘录只读全文、事件/提醒标题+日期）
 * - 添加能力：照片/录音/音乐库右上角「+」从设备导入文件（音频自动读时长，音乐另读 ID3 标签与封面）；
 *   备忘录/日历事件/提醒库「+」新建表单，写入同一 IndexedDB store —— 照片/音乐/备忘录/日历/提醒
 *   各原 App 直接展示这些数据，单条删除经 localDB.delete
 */

type LibKey = 'photos' | 'recordings' | 'music' | 'notes' | 'events' | 'reminders';

type SheetKind = 'note' | 'event' | 'reminder';

const LIBS: {
  key: LibKey;
  name: string;
  icon: typeof ImageIcon;
  empty: string;
  /** 可导入文件时的 accept（照片/录音/音乐） */
  accept?: string;
  /** 可新建表单时的类型（备忘录/事件/提醒） */
  form?: SheetKind;
}[] = [
  { key: 'photos', name: '照片', icon: ImageIcon, empty: '没有照片', accept: 'image/*' },
  { key: 'recordings', name: '录音', icon: Mic, empty: '没有录音', accept: 'audio/*' },
  { key: 'music', name: '音乐', icon: Music2, empty: '没有音乐', accept: 'audio/*' },
  { key: 'notes', name: '备忘录', icon: FileText, empty: '没有备忘录', form: 'note' },
  { key: 'events', name: '日历事件', icon: CalendarDays, empty: '没有事件', form: 'event' },
  { key: 'reminders', name: '提醒', icon: CircleCheck, empty: '没有提醒', form: 'reminder' },
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 字节数 → "N KB" / "x.x MB" */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 字节数 → GB 保留两位 */
function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0';
  if (p < 0.1) return '<0.1';
  return String(parseFloat(p.toFixed(1)));
}

/** 去扩展名（音乐导入兜底标题） */
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** 本地时区今天的 YYYY-MM-DD（date input 值） */
function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 用临时 Audio 元素读取音频时长（秒），失败/超时回退 0 */
function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = window.setTimeout(() => finish(0), 10000);
    el.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(el.duration) ? el.duration : 0);
    });
    el.addEventListener('error', () => {
      window.clearTimeout(timer);
      finish(0);
    });
    el.src = url;
  });
}

interface ParsedTags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: Blob;
}

/** 动态 import jsmediatags 读 ID3 标签与封面（与音乐 App 同款，失败回退空标签） */
async function readId3Tags(file: File): Promise<ParsedTags> {
  try {
    const mod = await import('jsmediatags/dist/jsmediatags.min.js');
    const readFn = mod.default?.read ?? mod.read;
    if (typeof readFn !== 'function') return {};
    return await new Promise<ParsedTags>((resolve) => {
      const timer = window.setTimeout(() => resolve({}), 6000);
      const options: ReadTagsOptions = {
        file,
        onSuccess: (result) => {
          window.clearTimeout(timer);
          const tags = result.tags ?? {};
          let picture: Blob | undefined;
          const pic = tags.picture;
          if (pic && Array.isArray(pic.data) && pic.data.length > 0) {
            picture = new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' });
          }
          resolve({ title: tags.title, artist: tags.artist, album: tags.album, picture });
        },
        onError: () => {
          window.clearTimeout(timer);
          resolve({});
        },
      };
      readFn(options);
    });
  } catch {
    return {};
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 纯文本 → 备忘录 HTML（每行一个 <p>，与备忘录 App 的 contenteditable 产出兼容） */
function textToHtml(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length === 1 && lines[0].trim() === '') return '';
  return lines.map((l) => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 备忘录阅读页顶部完整时间：2025年12月28日 下午3:45 */
function formatFull(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const ampm = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${ampm}${h12}:${pad2(d.getMinutes())}`;
}

function eventSub(e: CalendarEventRecord): string {
  const parts = e.date.split('-').map((v) => parseInt(v, 10));
  const base =
    parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? `${parts[1]}月${parts[2]}日` : e.date;
  if (!e.startTime) return `${base} 全天`;
  return `${base} ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}`;
}

function reminderSub(r: ReminderRecord): string {
  if (r.dueDate) {
    const parts = r.dueDate.split('-').map((v) => parseInt(v, 10));
    const base =
      parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? `${parts[1]}月${parts[2]}日` : r.dueDate;
    return r.dueTime ? `${base} ${r.dueTime}` : base;
  }
  return dateLabel(r.createdAt);
}

/** 备忘录 content 现为 HTML：剥标签取纯文本（块级元素/br 转换行，DOMParser 不执行脚本不加载资源） */
function notePlainText(content: string): string {
  if (!content) return '';
  const withBreaks = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|blockquote)>/gi, '\n');
  if (typeof DOMParser === 'undefined') return withBreaks.replace(/<[^>]*>/g, '');
  return (new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '').replace(/\u00a0/g, ' ');
}

function notePreviewLine(content: string): string {
  return notePlainText(content).replace(/\s+/g, ' ').trim().slice(0, 40);
}

// 模块级单例 Audio（同一时刻至多一个资料库在播，切歌/卸载时回收 ObjectURL）
let libAudio: HTMLAudioElement | null = null;
let libAudioUrl: string | null = null;
let libAudioEnded: (() => void) | null = null;

function getLibAudio(): HTMLAudioElement {
  if (!libAudio) {
    libAudio = new Audio();
    libAudio.addEventListener('ended', () => {
      if (libAudioUrl) {
        URL.revokeObjectURL(libAudioUrl);
        libAudioUrl = null;
      }
      libAudioEnded?.();
    });
  }
  return libAudio;
}

function stopLibAudio(): void {
  if (libAudio) libAudio.pause();
  if (libAudioUrl) {
    URL.revokeObjectURL(libAudioUrl);
    libAudioUrl = null;
  }
}

function resetLibAudio(): void {
  stopLibAudio();
  libAudioEnded = null;
}

/** 播放一段音频：先停旧源再换新 ObjectURL，结束/失败时回调 onEnded */
function playLibAudio(blob: Blob, onEnded: () => void): void {
  stopLibAudio();
  const a = getLibAudio();
  const url = URL.createObjectURL(blob);
  libAudioUrl = url;
  libAudioEnded = onEnded;
  a.src = url;
  void a.play().catch(() => {
    /* 自动播放被拦截或解码失败：回收并回调 */
    if (libAudioUrl) {
      URL.revokeObjectURL(libAudioUrl);
      libAudioUrl = null;
    }
    onEnded();
  });
}

interface LibStats {
  photos: number;
  recordings: number;
  musicCount: number;
  musicBytes: number;
  notes: number;
  events: number;
  reminders: number;
}

async function computeStats(): Promise<LibStats> {
  const [photos, recordings, music, notes, events, reminders] = await Promise.all([
    localDB.count('photos'),
    localDB.count('recordings'),
    localDB.getAll('music'),
    localDB.count('notes'),
    localDB.count('events'),
    localDB.count('reminders'),
  ]);
  return {
    photos,
    recordings,
    musicCount: music.length,
    musicBytes: music.reduce((sum, m) => sum + (m.blob?.size ?? 0), 0),
    notes,
    events,
    reminders,
  };
}

function statText(key: LibKey, stats: LibStats | null): string {
  if (!stats) return '';
  switch (key) {
    case 'photos':
      return `${stats.photos} 项`;
    case 'recordings':
      return `${stats.recordings} 项`;
    case 'music':
      return `${stats.musicCount} 项 · ${formatBytes(stats.musicBytes)}`;
    case 'notes':
      return `${stats.notes} 项`;
    case 'events':
      return `${stats.events} 项`;
    case 'reminders':
      return `${stats.reminders} 项`;
  }
}

// ---------------- 通用条目行 ----------------

function ItemRow({
  title,
  sub,
  leading,
  stateIcon,
  onTap,
  onDelete,
  deleteLabel,
  onDownload,
  downloadLabel,
}: {
  title: string;
  sub: string;
  leading?: ReactNode;
  stateIcon?: ReactNode;
  onTap?: () => void;
  onDelete: () => void;
  deleteLabel: string;
  /** #29：可选下载按钮（照片/录音/音乐） */
  onDownload?: () => void;
  downloadLabel?: string;
}) {
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={onTap}
        disabled={!onTap}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left transition-colors active:bg-muted/50 disabled:active:bg-transparent"
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-snug">{title}</span>
          {sub && (
            <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted-foreground">{sub}</span>
          )}
        </span>
        {stateIcon}
      </button>
      {/* #29：下载按钮（仅在传入 onDownload 时渲染） */}
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          aria-label={downloadLabel ?? '下载'}
          className="flex w-11 shrink-0 items-center justify-center"
        >
          <Download className="h-[18px] w-[18px] text-foreground/70" strokeWidth={1.9} />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        className="flex w-11 shrink-0 items-center justify-center"
      >
        <Trash2 className="h-[18px] w-[18px] text-[#FF453A]/80" strokeWidth={1.9} />
      </button>
    </div>
  );
}

// ---------------- 二级资料库页 ----------------

/** 新建表单层的 iOS 风格输入行 */
function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-[72px] shrink-0 text-[15px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

const formInputCls =
  'min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/50';

/** 新建表单层（备忘录/日历事件/提醒）：iOS 模态，保存写入对应 store */
function FormSheet({
  kind,
  name,
  onCancel,
  onSaved,
}: {
  kind: SheetKind;
  name: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [fileWheel, setFileWheel] = useState<null | 'event' | 'reminder'>(null); // 日期滚轮（第二十轮：上下滑式）
  const [dueTime, setDueTime] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (kind === 'note') {
        const rec: NoteRecord = {
          id: genId(),
          title: title.trim() || '新备忘录',
          content: textToHtml(body),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          category: '',
        };
        await localDB.put('notes', rec);
      } else if (kind === 'event') {
        const rec: CalendarEventRecord = {
          id: genId(),
          title: title.trim() || '无标题事件',
          date: date || toInputDate(new Date()),
          startTime,
          endTime,
          note,
          createdAt: Date.now(),
        };
        await localDB.put('events', rec);
      } else {
        const rec: ReminderRecord = {
          id: genId(),
          title: title.trim() || '未命名提醒',
          notes: note,
          completed: false,
          flagged: false,
          dueDate,
          dueTime,
          createdAt: Date.now(),
          completedAt: null,
        };
        await localDB.put('reminders', rec);
      }
      onSaved();
    } catch {
      /* IndexedDB 不可用等：留在表单层（用户可重试或取消） */
      setSaving(false);
    }
  }

  const titlePlaceholder =
    kind === 'note' ? '标题（默认“新备忘录”）' : kind === 'event' ? '标题（默认“无标题事件”）' : '标题（默认“未命名提醒”）';

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background">
      <IOSNavBar
        title={`新建${name.replace('库', '')}`}
        large={false}
        left={<IOSBackButton label="取消" onClick={onCancel} />}
        right={<IOSTextButton onClick={() => void save()}>存储</IOSTextButton>}
      />
      {/* 日期滚轮弹窗（第二十轮：上下滑式；事件日期 / 提醒截止日期共用） */}
      <WheelDatePicker
        open={fileWheel !== null}
        value={(fileWheel === 'reminder' ? dueDate : date) || ''}
        onConfirm={(v) => {
          if (fileWheel === 'reminder') setDueDate(v);
          else setDate(v);
          setFileWheel(null);
        }}
        onCancel={() => setFileWheel(null)}
        title="选择日期"
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[40px] pt-2">
        <div className="divide-y divide-border/60 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <FormRow label="标题">
            <input
              className={formInputCls}
              value={title}
              placeholder={titlePlaceholder}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="files-form-title"
            />
          </FormRow>

          {kind === 'note' && (
            <div className="px-4 py-2.5">
              <textarea
                className="min-h-[180px] w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
                value={body}
                placeholder="正文（可换行）"
                onChange={(e) => setBody(e.target.value)}
                data-testid="files-form-body"
              />
            </div>
          )}

          {kind === 'event' && (
            <>
              <FormRow label="日期">
                <button
                  type="button"
                  onClick={() => setFileWheel('event')}
                  aria-label="选择日期"
                  data-testid="files-date-open"
                  className={`flex h-8 flex-1 items-center justify-between rounded-lg px-2 text-[14px] ${date ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  <span>{date || '请选择日期'}</span>
                  <span className="text-[12px] opacity-60">点击选择</span>
                </button>
              </FormRow>
              <FormRow label="开始">
                <input
                  type="time"
                  className={formInputCls}
                  value={startTime}
                  placeholder="留空为全天"
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </FormRow>
              <FormRow label="结束">
                <input type="time" className={formInputCls} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </FormRow>
              <FormRow label="备注">
                <input
                  className={formInputCls}
                  value={note}
                  placeholder="可选"
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormRow>
            </>
          )}

          {kind === 'reminder' && (
            <>
              <FormRow label="截止日期">
                <button
                  type="button"
                  onClick={() => setFileWheel('reminder')}
                  aria-label="选择截止日期"
                  data-testid="files-duedate-open"
                  className={`flex h-8 flex-1 items-center justify-between rounded-lg px-2 text-[14px] ${dueDate ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  <span>{dueDate || '请选择日期'}</span>
                  <span className="text-[12px] opacity-60">点击选择</span>
                </button>
              </FormRow>
              <FormRow label="截止时间">
                <input
                  type="time"
                  className={formInputCls}
                  value={dueTime}
                  placeholder="可选"
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </FormRow>
              <FormRow label="备注">
                <input
                  className={formInputCls}
                  value={note}
                  placeholder="可选"
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormRow>
            </>
          )}
        </div>
        <p className="px-1 pt-3 text-[12px] leading-relaxed text-muted-foreground">
          保存后可在对应的{kind === 'note' ? '备忘录' : kind === 'event' ? '日历' : '提醒事项'}应用中查看与编辑。
        </p>
      </div>
    </div>
  );
}

function LibraryView({
  lib,
  name,
  onBack,
  onChanged,
}: {
  lib: LibKey;
  name: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [music, setMusic] = useState<MusicRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const urlMapRef = useRef<Record<string, string>>({});

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // 添加能力：导入文件 / 新建表单
  const [reloadTick, setReloadTick] = useState(0);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const meta = LIBS.find((l) => l.key === lib) ?? LIBS[0];
  const count =
    lib === 'photos'
      ? photos.length
      : lib === 'recordings'
        ? recordings.length
        : lib === 'music'
          ? music.length
          : lib === 'notes'
            ? notes.length
            : lib === 'events'
              ? events.length
              : reminders.length;

  // 加载列表（await 之后再 setState），照片同时生成 ObjectURL；添加/删除后 reloadTick 触发重载
  useEffect(() => {
    let alive = true;
    // 重载前回收上一轮照片 ObjectURL（避免泄漏）
    for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
    urlMapRef.current = {};
    void (async () => {
      try {
        switch (lib) {
          case 'photos': {
            const list = await localDB.getAll('photos');
            list.sort((a, b) => b.createdAt - a.createdAt);
            const map: Record<string, string> = {};
            for (const p of list) map[p.id] = URL.createObjectURL(p.blob);
            urlMapRef.current = map;
            if (alive) {
              setPhotos(list);
              setPhotoUrls(map);
            }
            break;
          }
          case 'recordings': {
            const list = await localDB.getAll('recordings');
            list.sort((a, b) => b.createdAt - a.createdAt);
            if (alive) setRecordings(list);
            break;
          }
          case 'music': {
            const list = await localDB.getAll('music');
            list.sort((a, b) => b.createdAt - a.createdAt);
            if (alive) setMusic(list);
            break;
          }
          case 'notes': {
            const list = await localDB.getAll('notes');
            list.sort((a, b) => b.updatedAt - a.updatedAt);
            if (alive) setNotes(list);
            break;
          }
          case 'events': {
            const list = await localDB.getAll('events');
            list.sort((a, b) => {
              if (a.date !== b.date) return a.date < b.date ? -1 : 1;
              return a.startTime < b.startTime ? -1 : 1;
            });
            if (alive) setEvents(list);
            break;
          }
          case 'reminders': {
            const list = await localDB.getAll('reminders');
            list.sort((a, b) => {
              if (a.completed !== b.completed) return a.completed ? 1 : -1;
              return a.createdAt - b.createdAt;
            });
            if (alive) setReminders(list);
            break;
          }
        }
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [lib, reloadTick]);

  // 卸载清理：回收全部照片 ObjectURL 并停止播放
  useEffect(() => {
    return () => {
      for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
      urlMapRef.current = {};
      resetLibAudio();
    };
  }, []);

  function stopPlayback() {
    stopLibAudio();
    setPlayingId(null);
  }

  /** 单例 Audio 点按播放/暂停（录音/音乐共用） */
  function togglePlay(blob: Blob, id: string) {
    if (playingId === id) {
      stopPlayback();
      return;
    }
    setPlayingId(id);
    playLibAudio(blob, () => setPlayingId(null));
  }

  /** #29：下载 Blob 到本地（a.download 兑底；点击后创建临时 ObjectURL 并触发下载） */
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function deleteById(id: string, label: string) {
    if (!window.confirm(`确定删除"${label}"吗？`)) return;
    if (lib === 'photos') {
      const url = urlMapRef.current[id];
      if (url) {
        URL.revokeObjectURL(url);
        delete urlMapRef.current[id];
        setPhotoUrls((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      setPhotos((prev) => prev.filter((x) => x.id !== id));
      if (previewId === id) setPreviewId(null);
    } else if (lib === 'recordings') {
      if (playingId === id) stopPlayback();
      setRecordings((prev) => prev.filter((x) => x.id !== id));
    } else if (lib === 'music') {
      if (playingId === id) stopPlayback();
      setMusic((prev) => prev.filter((x) => x.id !== id));
    } else if (lib === 'notes') {
      setNotes((prev) => prev.filter((x) => x.id !== id));
      if (openNoteId === id) setOpenNoteId(null);
    } else if (lib === 'events') {
      setEvents((prev) => prev.filter((x) => x.id !== id));
    } else {
      setReminders((prev) => prev.filter((x) => x.id !== id));
    }
    void localDB.delete(lib, id).catch(() => undefined);
    onChanged();
  }

  /** 添加入口：可导入库弹文件选择器，表单库打开新建层 */
  function handleAddTap() {
    if (meta.accept) {
      fileInputRef.current?.click();
      return;
    }
    if (meta.form) setSheet(meta.form);
  }

  /** 添加/导入成功后的公共收尾：重载列表 + 刷新根级统计 */
  function afterChange() {
    setSheet(null);
    setReloadTick((t) => t + 1);
    onChanged();
  }

  /** 从设备导入文件（可多选）：照片直接入库；录音/音乐先读时长，音乐另读 ID3 标签 */
  async function handleImport(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setImporting({ done: 0, total: files.length });
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (lib === 'photos') {
          const rec: PhotoRecord = { id: genId(), blob: file, name: file.name, createdAt: Date.now() };
          await localDB.put('photos', rec);
        } else if (lib === 'recordings') {
          const duration = await readAudioDuration(file);
          const rec: RecordingRecord = { id: genId(), blob: file, name: file.name, duration, createdAt: Date.now() };
          await localDB.put('recordings', rec);
        } else if (lib === 'music') {
          const [duration, tags] = await Promise.all([readAudioDuration(file), readId3Tags(file)]);
          const rec: MusicRecord = {
            id: genId(),
            blob: file,
            name: file.name,
            title: tags.title?.trim() || stripExt(file.name),
            artist: tags.artist?.trim() || '未知歌手',
            album: tags.album?.trim() || '',
            cover: tags.picture ?? null,
            duration,
            createdAt: Date.now(),
          };
          await localDB.put('music', rec);
        }
        setImporting({ done: i + 1, total: files.length });
      }
    } catch {
      /* 单文件失败不中断其余导入 */
    }
    setImporting(null);
    afterChange();
  }

  const openNote = openNoteId ? (notes.find((n) => n.id === openNoteId) ?? null) : null;
  const previewUrl = previewId ? (photoUrls[previewId] ?? null) : null;
  const previewName = previewId ? (photos.find((p) => p.id === previewId)?.name ?? '照片') : '';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar
          title={name}
          large={false}
          left={<IOSBackButton label="文件" onClick={onBack} />}
          right={
            (meta.accept || meta.form) && !importing ? (
              <button
                type="button"
                aria-label={`添加到${name}`}
                data-testid={`files-add-${lib}`}
                onClick={handleAddTap}
                className="rounded-full p-1 transition-opacity active:opacity-50"
              >
                <Plus className="h-6 w-6" strokeWidth={2} />
              </button>
            ) : undefined
          }
        />
        {/* 隐藏文件选择器（照片/录音/音乐导入） */}
        <input
          ref={fileInputRef}
          type="file"
          accept={meta.accept}
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            void handleImport(files);
            e.target.value = '';
          }}
        />

        <div className="px-4 pb-[40px] pt-1">
          {loaded && count === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-24 text-muted-foreground">
              <meta.icon className="h-12 w-12 opacity-40" strokeWidth={1.1} />
              <div className="text-[17px] font-medium text-foreground/70">{meta.empty}</div>
            </div>
          ) : (
            <div className="divide-y divide-border/60 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
              {lib === 'photos' &&
                photos.map((p) => (
                  <ItemRow
                    key={p.id}
                    title={p.name || '未命名照片'}
                    sub={`${dateLabel(p.createdAt)} · ${formatBytes(p.blob.size)}`}
                    leading={
                      photoUrls[p.id] ? (
                        <img
                          src={photoUrls[p.id]}
                          alt={p.name || '照片'}
                          className="h-11 w-11 shrink-0 rounded-[8px] object-cover"
                        />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-muted">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
                        </span>
                      )
                    }
                    onTap={() => setPreviewId(p.id)}
                    onDelete={() => deleteById(p.id, p.name || '未命名照片')}
                    deleteLabel="删除照片"
                    onDownload={() => downloadBlob(p.blob, p.name || `photo-${p.id}.jpg`)}
                    downloadLabel="下载照片"
                  />
                ))}

              {lib === 'recordings' &&
                recordings.map((r) => (
                  <ItemRow
                    key={r.id}
                    title={r.name || '未命名录音'}
                    sub={`${dateLabel(r.createdAt)} · ${formatDuration(r.duration)}`}
                    stateIcon={
                      playingId === r.id ? (
                        <Pause className="h-5 w-5 shrink-0 text-foreground" strokeWidth={1.9} />
                      ) : (
                        <Play className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                      )
                    }
                    onTap={() => togglePlay(r.blob, r.id)}
                    onDelete={() => deleteById(r.id, r.name || '未命名录音')}
                    deleteLabel="删除录音"
                    onDownload={() => downloadBlob(r.blob, `${r.name || 'recording'}.webm`)}
                    downloadLabel="下载录音"
                  />
                ))}

              {lib === 'music' &&
                music.map((m) => (
                  <ItemRow
                    key={m.id}
                    title={m.title || m.name || '未命名音乐'}
                    sub={`${m.artist ? `${m.artist} · ` : ''}${dateLabel(m.createdAt)} · ${formatDuration(
                      m.duration
                    )} · ${formatBytes(m.blob.size)}`}
                    stateIcon={
                      playingId === m.id ? (
                        <Pause className="h-5 w-5 shrink-0 text-foreground" strokeWidth={1.9} />
                      ) : (
                        <Play className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                      )
                    }
                    onTap={() => togglePlay(m.blob, m.id)}
                    onDelete={() => deleteById(m.id, m.title || m.name || '未命名音乐')}
                    deleteLabel="删除音乐"
                    onDownload={() => downloadBlob(m.blob, `${m.title || m.name || 'music'}.mp3`)}
                    downloadLabel="下载音乐"
                  />
                ))}

              {lib === 'notes' &&
                notes.map((n) => {
                  const preview = notePreviewLine(n.content);
                  return (
                    <ItemRow
                      key={n.id}
                      title={n.title || '新备忘录'}
                      sub={`${dateLabel(n.updatedAt)}${preview ? ` · ${preview}` : ''}`}
                      onTap={() => setOpenNoteId(n.id)}
                      onDelete={() => deleteById(n.id, n.title || '新备忘录')}
                      deleteLabel="删除备忘录"
                    />
                  );
                })}

              {lib === 'events' &&
                events.map((e) => (
                  <ItemRow
                    key={e.id}
                    title={e.title || '无标题事件'}
                    sub={eventSub(e)}
                    stateIcon={<CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground/60" strokeWidth={1.8} />}
                    onDelete={() => deleteById(e.id, e.title || '无标题事件')}
                    deleteLabel="删除事件"
                  />
                ))}

              {lib === 'reminders' &&
                reminders.map((r) => (
                  <ItemRow
                    key={r.id}
                    title={r.title || '未命名提醒'}
                    sub={r.completed ? `已完成 · ${reminderSub(r)}` : reminderSub(r)}
                    stateIcon={
                      <CircleCheck
                        className={`h-5 w-5 shrink-0 ${r.completed ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}
                        strokeWidth={1.8}
                      />
                    }
                    onDelete={() => deleteById(r.id, r.title || '未命名提醒')}
                    deleteLabel="删除提醒"
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* 照片大图预览层（点击任意处关闭） */}
      {previewUrl && (
        <div className="absolute inset-0 z-50 flex flex-col bg-black" onClick={() => setPreviewId(null)}>
          <div className="flex h-[54px] shrink-0 items-center justify-between px-4">
            {/* #29：预览层左上角“下载”按钮（与右上角关闭按钮对称） */}
            <button
              type="button"
              aria-label="下载照片"
              onClick={(e) => {
                e.stopPropagation();
                const p = photos.find((x) => x.id === previewId);
                if (p) downloadBlob(p.blob, p.name || `photo-${p.id}.jpg`);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.10] text-white/90 ring-1 ring-white/[0.14] backdrop-blur-2xl transition-opacity active:opacity-60"
            >
              <Download className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <button aria-label="关闭预览" className="rounded-full p-1.5 transition-opacity active:opacity-60">
              <X className="h-6 w-6 text-white/90" strokeWidth={2} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 pb-10">
            <img src={previewUrl} alt={previewName} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}

      {/* 导入进度提示（照片/录音/音乐多文件导入） */}
      {importing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[44px]">
          <div className="rounded-full bg-black/60 px-4 py-1.5 text-[13px] font-medium text-white shadow-lg ring-1 ring-white/[0.14] backdrop-blur-xl">
            正在导入 {importing.done}/{importing.total}…
          </div>
        </div>
      )}

      {/* 新建表单层（备忘录/日历事件/提醒） */}
      {sheet && <FormSheet kind={sheet} name={name} onCancel={() => setSheet(null)} onSaved={afterChange} />}

      {/* 备忘录只读全文层 */}
      {openNote && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background">
          <IOSNavBar
            title={openNote.title || '备忘录'}
            large={false}
            left={<IOSBackButton label="完成" onClick={() => setOpenNoteId(null)} />}
          />
          <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-10">
            <div className="pb-3 pt-1 text-center text-[12px] text-muted-foreground">
              {formatFull(openNote.updatedAt)}
            </div>
            <div className="whitespace-pre-wrap break-words text-[17px] leading-[1.6] text-foreground">
              {notePlainText(openNote.content) || '（空备忘录）'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 根级页 ----------------

export default function FilesApp() {
  const [view, setView] = useState<LibKey | 'root'>('root');
  const [stats, setStats] = useState<LibStats | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const refreshStats = useCallback(() => {
    void (async () => {
      try {
        setStats(await computeStats());
      } catch {
        /* IndexedDB 不可用时保持空统计 */
      }
    })();
  }, []);

  // 挂载：统计 + 存储估算（setState 均在 await 之后的异步回调内）
  useEffect(() => {
    refreshStats();
    let alive = true;
    void (async () => {
      try {
        if (typeof navigator.storage?.estimate === 'function') {
          const est = await navigator.storage.estimate();
          if (alive) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
        }
      } catch {
        /* 忽略存储估算失败 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshStats]);

  // 从二级页返回：刷新统计（可能存在删除）
  const handleBack = useCallback(() => {
    setView('root');
    refreshStats();
  }, [refreshStats]);

  if (view !== 'root') {
    const lib = LIBS.find((l) => l.key === view);
    return <LibraryView key={view} lib={view} name={lib?.name ?? ''} onBack={handleBack} onChanged={refreshStats} />;
  }

  const pct = storage && storage.quota > 0 ? (storage.usage / storage.quota) * 100 : 0;
  const barWidth = pct > 0 ? Math.min(100, Math.max(1.5, pct)) : 0;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="文件" left={<BackToHome className="static!" />} />

        {/* 位置头：我的 iPhone（纯展示，无跳转故不加箭头） */}
        <div className="flex items-center gap-3 px-5 pb-2 pt-1">
          <HardDrive className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className="flex-1 text-[17px]">我的 iPhone</span>
        </div>

        {/* 存储空间卡 */}
        <div className="mx-4 mt-1 rounded-[20px] bg-white/60 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[16px] font-semibold">存储空间</span>
            <span className="text-[13px] text-muted-foreground">
              {storage ? `${formatBytes(storage.usage)} / ${formatGB(storage.quota)}` : '计算中…'}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/60 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-500"
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-2 text-[12px] text-muted-foreground">
            {storage ? `${formatPct(pct)}% 已使用` : ''}
          </div>
        </div>

        {/* 资料库列表卡 */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          {LIBS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setView(l.key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-b from-[#C8C8CD] to-[#8E8E93] dark:from-[#5A5A5F] dark:to-[#3A3A3E]">
                <l.icon className="h-5 w-5 text-white" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[17px]">{l.name}</span>
              <span className="shrink-0 text-[15px] text-muted-foreground">{statText(l.key, stats)}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
            </button>
          ))}
        </div>

        <div className="px-8 pb-[40px] pt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
          照片、录音、音乐可从右上角「+」导入设备文件；备忘录、日历事件、提醒可在此新建，与各应用数据互通。
        </div>
      </div>
    </div>
  );
}
