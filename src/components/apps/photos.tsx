'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type TouchEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  Images,
  LockKeyhole,
  Minus,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
  Wallpaper,
} from 'lucide-react';
import { genId, localDB, type PhotoRecord } from '@/lib/ios/db';
import { useSettings } from '@/lib/ios/store';
import { IOSNavBar, IOSTextButton } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';

/**
 * 相册 App（iOS 18 风格）：底部毛玻璃胶囊三 tab（照片/相册/收藏）+
 * 年/月/日分组图库 + 自定义相册（新建/重命名/删除/加照片/移出）+ 多选批量操作 + 全屏照片查看器。
 * 浅色模式下列表/网格为 bg-background 浅色；仅查看器内为黑底（图片查看场景）。
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

/** 自定义相册数据在 kv store 的键（value = PhotoAlbum[]，整体读写；照片本体仍在 photos 表） */
const ALBUMS_KV_KEY = 'ios-photo-albums';

/** #65：pruneDeletedFromAlbums 串行化锁——模块级 Promise 链，连点删除多张照片时
 *  读-改-写按序排队，避免最后写回覆盖前一次清理结果 */
let pruneLock: Promise<void> = Promise.resolve();
/** 模块级封装：把任务挂到 pruneLock 链尾，避免在组件内重赋模块变量触发 eslint react-hooks/globals */
function withPruneLock(task: () => Promise<void>): Promise<void> {
  pruneLock = pruneLock.then(task).catch(() => undefined);
  return pruneLock;
}

/**
 * 相册记录的本地扩展：收藏标记。
 * favorite 以「记录内可选字段」直存 IndexedDB（put 整条记录带上该字段），
 * 对象存储对新增可选字段天然兼容，无需升级 DB 版本；旧记录无该字段 = 未收藏。
 */
type FavPhoto = PhotoRecord & { favorite?: boolean };

/** 自定义相册（可建多个、自定义名字；photoIds 指向 photos 表记录，照片本体不迁移） */
interface PhotoAlbum {
  id: string;
  name: string;
  createdAt: number;
  photoIds: string[];
}

/** 底部三 tab */
type TabKey = 'photos' | 'albums' | 'favorites';

/** kv 读出的相册数组运行时校验：整体非数组 → 空数组；逐项须有 string id / string name / Array photoIds，不合格丢弃 */
function parseAlbums(value: unknown): PhotoAlbum[] {
  if (!Array.isArray(value)) return [];
  const out: PhotoAlbum[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Partial<PhotoAlbum>;
    if (typeof rec.id !== 'string' || rec.id === '') continue;
    if (typeof rec.name !== 'string') continue;
    if (!Array.isArray(rec.photoIds)) continue;
    out.push({
      id: rec.id,
      name: rec.name,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
      photoIds: rec.photoIds.filter((pid): pid is string => typeof pid === 'string'),
    });
  }
  return out;
}

interface DayGroup {
  key: string;
  label: string;
  photos: FavPhoto[];
}

interface MonthGroup {
  key: string;
  label: string;
  days: DayGroup[];
}

interface YearGroup {
  key: string;
  label: string;
  months: MonthGroup[];
}

/** 底部胶囊 tab 定义（照片=Image / 相册=Images / 收藏=Heart） */
const ALBUM_TABS: { key: TabKey; label: string; icon: typeof ImageIcon }[] = [
  { key: 'photos', label: '照片', icon: ImageIcon },
  { key: 'albums', label: '相册', icon: Images },
  { key: 'favorites', label: '收藏', icon: Heart },
];

/** 按 年 → 月 → 日 分组（传入的照片需已按 createdAt 倒序） */
function buildYearGroups(photos: FavPhoto[]): YearGroup[] {
  const years: YearGroup[] = [];
  const yearMap = new Map<number, YearGroup>();
  const monthMap = new Map<string, MonthGroup>();
  const dayMap = new Map<string, DayGroup>();

  for (const photo of photos) {
    const date = new Date(photo.createdAt);
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();

    let yearGroup = yearMap.get(y);
    if (!yearGroup) {
      yearGroup = { key: `y-${y}`, label: `${y}年`, months: [] };
      yearMap.set(y, yearGroup);
      years.push(yearGroup);
    }

    const monthKey = `${y}-${m}`;
    let monthGroup = monthMap.get(monthKey);
    if (!monthGroup) {
      monthGroup = { key: `m-${monthKey}`, label: `${m + 1}月`, days: [] };
      monthMap.set(monthKey, monthGroup);
      yearGroup.months.push(monthGroup);
    }

    const dayKey = `${y}-${m}-${d}`;
    let dayGroup = dayMap.get(dayKey);
    if (!dayGroup) {
      dayGroup = {
        key: `d-${dayKey}`,
        label: `${m + 1}月${d}日 ${WEEKDAYS[date.getDay()]}`,
        photos: [],
      };
      dayMap.set(dayKey, dayGroup);
      monthGroup.days.push(dayGroup);
    }

    dayGroup.photos.push(photo);
  }

  return years;
}

function groupCount(months: MonthGroup[]): number {
  return months.reduce((sum, mg) => sum + mg.days.reduce((k, dg) => k + dg.photos.length, 0), 0);
}

/** 查看器顶部的照片日期：同年初省年份，如 "12月28日 星期六" */
function photoViewerDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yearPart = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年` : '';
  return `${yearPart}${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/** 相册 photoIds 中仍真实存在的照片（防悬空 id；保持 photoIds 顺序，封面/计数/详情网格共用） */
function validAlbumPhotos(alb: PhotoAlbum, photoMap: Map<string, FavPhoto>): FavPhoto[] {
  const out: FavPhoto[] = [];
  for (const pid of alb.photoIds) {
    const p = photoMap.get(pid);
    if (p) out.push(p);
  }
  return out;
}

interface PhotoTileProps {
  photo: FavPhoto;
  url: string | undefined;
  ariaLabel: string;
  /** 是否显示多选圈 */
  selecting: boolean;
  selected: boolean;
  onClick: () => void;
}

/** 图库 / 相册详情 / 照片选择器共用的方形缩略图块（❤角标 + 多选圈样式复用） */
function PhotoTile({ photo, url, ariaLabel, selecting, selected, onClick }: PhotoTileProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="relative block aspect-square w-full overflow-hidden bg-muted transition-opacity active:opacity-80"
    >
      <img
        src={url}
        alt={photo.name}
        loading="lazy"
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
      {/* 收藏角标（左下角，避开左上角多选圈） */}
      {photo.favorite && (
        <Heart
          aria-hidden="true"
          className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-[#FF453A] text-[#FF453A] drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]"
          strokeWidth={2}
        />
      )}
      {selecting && (
        <span
          className={`absolute left-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] backdrop-blur-sm transition-colors ${
            selected ? 'border-foreground bg-foreground' : 'border-white/90 bg-black/25'
          }`}
        >
          {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />}
        </span>
      )}
    </button>
  );
}

/** 相册名弹窗：新建 / 重命名 */
type AlbumDialogState = { mode: 'create' } | { mode: 'rename'; albumId: string };

/** 相册 App：底部三 tab（照片/相册/收藏）+ 自定义相册 + 年/月/日分组图库 + 全屏照片查看器 */
export default function PhotosApp() {
  const [photos, setPhotos] = useState<FavPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [wallpaperOk, setWallpaperOk] = useState(false);
  const [lockWallpaperOk, setLockWallpaperOk] = useState(false);

  // 底部三 tab 与自定义相册
  const [activeTab, setActiveTab] = useState<TabKey>('photos');
  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  /** 相册详情页（推入二级页：覆盖三 tab，tab 栏收起） */
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
  const [albumsEditMode, setAlbumsEditMode] = useState(false);
  const [albumDialog, setAlbumDialog] = useState<AlbumDialogState | null>(null);
  const [albumNameDraft, setAlbumNameDraft] = useState('');
  // 相册详情的「添加照片」全屏选择器
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIds, setPickerIds] = useState<Set<string>>(new Set());

  // 多选模式
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 查看器"更多"菜单
  const [moreOpen, setMoreOpen] = useState(false);

  /** 照片 id → ObjectURL（渲染用，随列表刷新整体更新） */
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  /** ObjectURL 回收登记（仅 effect/cleanup 读写，不参与渲染） */
  const urlsRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);
  const wallpaperTimerRef = useRef<number | null>(null);
  const lockWallpaperTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 加载照片列表 + 相册 kv（并行读取），并同步管理 ObjectURL（await 之后再 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [all, albumsKv] = await Promise.all([
        localDB.getAll('photos'),
        localDB.get('kv', ALBUMS_KV_KEY),
      ]);
      if (cancelled) return;
      all.sort((a, b) => b.createdAt - a.createdAt);

      const prev = urlsRef.current;
      const next = new Map<string, string>();
      for (const p of all) {
        const reused = prev.get(p.id);
        next.set(p.id, reused ?? URL.createObjectURL(p.blob));
      }
      for (const [id, url] of prev) {
        if (!next.has(id)) URL.revokeObjectURL(url);
      }
      urlsRef.current = next;

      setUrls(next);
      setPhotos(all);
      setAlbums(parseAlbums(albumsKv?.value));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 卸载时回收全部 ObjectURL 与定时器
  useEffect(() => {
    return () => {
      if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current);
      if (lockWallpaperTimerRef.current !== null) window.clearTimeout(lockWallpaperTimerRef.current);
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  // 切 tab / 进出相册详情时回到列表顶部（iOS 二级页从顶部开始）
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab, openAlbumId]);

  // ---------------- 派生数据 ----------------

  /** 照片 id → 记录（相册 photoIds 防悬空过滤用） */
  const photoMap = useMemo(
    () => new Map(photos.map((p): [string, FavPhoto] => [p.id, p])),
    [photos]
  );

  /** 当前打开的相册（id 悬空时按未打开处理，回到 tab 视图） */
  const openAlbum = openAlbumId ? (albums.find((a) => a.id === openAlbumId) ?? null) : null;

  /** 相册详情网格数据（photoIds 顺序，只含仍存在的照片） */
  const albumPhotos = useMemo(
    () => (openAlbum ? validAlbumPhotos(openAlbum, photoMap) : []),
    [openAlbum, photoMap]
  );

  // 当前上下文的可见照片列表：相册详情=该相册有效照片 / 收藏 tab=已收藏 / 照片 tab=全部。
  // 查看器、横滑切换、单删/批量、左右箭头边界均以此列表为准（上下文自洽）
  const visiblePhotos = useMemo(() => {
    if (openAlbum) return albumPhotos;
    if (activeTab === 'favorites') return photos.filter((p) => p.favorite);
    return photos;
  }, [openAlbum, albumPhotos, activeTab, photos]);

  const yearGroups = useMemo(() => buildYearGroups(visiblePhotos), [visiblePhotos]);

  const viewerPhoto = viewerId ? (visiblePhotos.find((p) => p.id === viewerId) ?? null) : null;
  const viewerIdx = viewerPhoto ? visiblePhotos.findIndex((p) => p.id === viewerPhoto.id) : -1;
  /** 当前查看照片的收藏态（持久化字段，写库后由列表状态驱动） */
  const hearted = viewerPhoto?.favorite === true;

  /** 底部胶囊可见性：全屏查看器 / 多选工具栏 / 相册详情（二级页）/ 照片选择器任一打开即收起 */
  const capsuleVisible = !viewerPhoto && !selectMode && !openAlbum && !pickerOpen;

  // ---------------- 交互 ----------------

  const openViewer = (id: string) => {
    setViewerId(id);
    setZoomed(false);
    setMoreOpen(false);
  };

  /** 查看器内左右切换（delta: +1 下一张 / -1 上一张，到头不动；边界以当前上下文列表为准） */
  const stepViewer = (delta: number) => {
    if (viewerIdx < 0) return;
    const nextIdx = viewerIdx + delta;
    if (nextIdx < 0 || nextIdx >= visiblePhotos.length) return;
    setViewerId(visiblePhotos[nextIdx].id);
    setZoomed(false);
    setMoreOpen(false);
  };

  /**
   * 查看器❤：切换收藏并整条写回 IndexedDB。
   * 乐观更新本地列表（心形即时反馈），写库失败时回滚；
   * 收藏 tab 内取消收藏时照片即将离开当前列表，先切到相邻照片（与删除同款行为）。
   */
  const toggleFavorite = async () => {
    const rec = viewerPhoto;
    if (!rec) return;
    const next: FavPhoto = { ...rec, favorite: !rec.favorite };
    if (!openAlbum && activeTab === 'favorites' && rec.favorite) {
      const neighbor = visiblePhotos[viewerIdx + 1] ?? visiblePhotos[viewerIdx - 1] ?? null;
      setViewerId(neighbor ? neighbor.id : null);
    }
    setPhotos((prev) => prev.map((p) => (p.id === rec.id ? next : p)));
    try {
      await localDB.put('photos', next);
    } catch {
      setPhotos((prev) => prev.map((p) => (p.id === rec.id ? rec : p)));
    }
  };

  /** 底部胶囊切 tab：收起查看器/多选（相册详情、选择器、弹窗在胶囊可见时本已关闭，防御性复位） */
  const switchTab = (tab: TabKey) => {
    if (tab === activeTab) return;
    setViewerId(null);
    setZoomed(false);
    if (selectMode) exitSelectMode();
    setAlbumsEditMode(false);
    setAlbumDialog(null);
    setPickerOpen(false);
    setOpenAlbumId(null);
    setActiveTab(tab);
  };

  const openAlbumDetail = (albumId: string) => {
    setViewerId(null);
    if (selectMode) exitSelectMode();
    setAlbumsEditMode(false);
    setOpenAlbumId(albumId);
  };

  const closeAlbumDetail = () => {
    setOpenAlbumId(null);
    setViewerId(null);
    setZoomed(false);
    if (selectMode) exitSelectMode();
    setPickerOpen(false);
  };

  // ---------------- 相册 CRUD（kv 整体读写） ----------------

  /** 相册数组整体写回 kv（乐观更新即时反馈，写库失败回滚内存态） */
  const writeAlbums = async (next: PhotoAlbum[]) => {
    const prev = albums;
    setAlbums(next);
    try {
      await localDB.put('kv', { key: ALBUMS_KV_KEY, value: next });
    } catch {
      setAlbums(prev);
    }
  };

  const startCreateAlbum = () => {
    setAlbumNameDraft('');
    setAlbumDialog({ mode: 'create' });
  };

  const startRenameAlbum = (alb: PhotoAlbum) => {
    setAlbumNameDraft(alb.name);
    setAlbumDialog({ mode: 'rename', albumId: alb.id });
  };

  const confirmAlbumDialog = async () => {
    if (!albumDialog) return;
    const name = albumNameDraft.trim();
    if (!name) return;
    if (albumDialog.mode === 'create') {
      await writeAlbums([{ id: genId(), name, createdAt: Date.now(), photoIds: [] }, ...albums]);
    } else {
      await writeAlbums(albums.map((a) => (a.id === albumDialog.albumId ? { ...a, name } : a)));
    }
    setAlbumDialog(null);
  };

  /** 删除相册：仅删相册记录，照片本体不动 */
  const handleDeleteAlbum = async (alb: PhotoAlbum) => {
    if (!window.confirm(`删除相册「${alb.name}」？照片不会删除。`)) return;
    const next = albums.filter((a) => a.id !== alb.id);
    await writeAlbums(next);
    if (next.length === 0) setAlbumsEditMode(false);
  };

  /** 数据卫生：照片本体删除后，把被删 id 从所有相册 photoIds 里清掉（读 kv 最新值再写回，防闭包旧态覆盖）
   *  #65：用模块级 pruneLock 串行化读-改-写——连点删除多张照片时按序排队，避免并发读-改-写竞态丢更新 */
  const pruneDeletedFromAlbums = async (ids: string[]) => {
    if (ids.length === 0) return;
    await withPruneLock(async () => {
      const removed = new Set(ids);
      try {
        const kv = await localDB.get('kv', ALBUMS_KV_KEY);
        const current = parseAlbums(kv?.value);
        let changed = false;
        const next = current.map((alb) => {
          const kept = alb.photoIds.filter((pid) => !removed.has(pid));
          if (kept.length === alb.photoIds.length) return alb;
          changed = true;
          return { ...alb, photoIds: kept };
        });
        if (changed) await localDB.put('kv', { key: ALBUMS_KV_KEY, value: next });
      } catch {
        /* 卫生清理失败不影响删除主流程；悬空 id 由「只渲染仍存在照片」兜底 */
      }
    });
  };

  // ---------------- 相册详情：添加照片选择器 ----------------

  const openAlbumPicker = () => {
    if (!openAlbum) return;
    // 已在相册里的照片默认勾选（可取消勾选 = 移出）
    setPickerIds(new Set(openAlbum.photoIds));
    setPickerOpen(true);
  };

  const togglePickerPhoto = (id: string) => {
    setPickerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 完成：按选择器最终勾选态覆盖式写回 album.photoIds（旧成员保序 + 新增按图库顺序追加，天然去重） */
  const confirmAlbumPicker = async () => {
    if (!openAlbum) return;
    const kept = openAlbum.photoIds.filter((pid) => pickerIds.has(pid) && photoMap.has(pid));
    const added = photos
      .filter((p) => pickerIds.has(p.id) && !openAlbum.photoIds.includes(p.id))
      .map((p) => p.id);
    await writeAlbums(
      albums.map((a) => (a.id === openAlbum.id ? { ...a, photoIds: [...kept, ...added] } : a))
    );
    setPickerOpen(false);
  };

  // ---------------- 多选 ----------------

  const enterSelectMode = () => {
    setSelectedIds(new Set());
    setSelectMode(true);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 相册详情多选：把所选照片移出相册（不动照片本体） */
  const handleRemoveFromAlbum = async () => {
    if (!openAlbum || selectedIds.size === 0) return;
    const removeSet = new Set(selectedIds);
    const nextIds = openAlbum.photoIds.filter((pid) => !removeSet.has(pid));
    await writeAlbums(
      albums.map((a) => (a.id === openAlbum.id ? { ...a, photoIds: nextIds } : a))
    );
    exitSelectMode();
  };

  // ---------------- 照片上传/分享/删除 ----------------

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    for (const file of files) {
      await localDB.put('photos', { id: genId(), blob: file, name: file.name, createdAt: Date.now() });
    }
    setReloadKey((k) => k + 1);
  };

  /** 单张分享：优先系统分享面板，不支持时回退为下载 */
  const handleShare = async () => {
    const rec = viewerPhoto;
    if (!rec) return;
    const file = new File([rec.blob], rec.name || 'photo.jpg', { type: rec.blob.type || 'image/jpeg' });
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch {
        // 用户取消分享，忽略
      }
      return;
    }
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = rec.name || 'photo.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** 多选批量分享：系统面板一次带全部文件，不支持时逐张下载 */
  const handleBatchShare = async () => {
    const recs = visiblePhotos.filter((p) => selectedIds.has(p.id));
    if (recs.length === 0) return;
    const files = recs.map((r) => new File([r.blob], r.name || 'photo.jpg', { type: r.blob.type || 'image/jpeg' }));
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
      } catch {
        // 用户取消分享，忽略
      }
      return;
    }
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const handleSetWallpaper = () => {
    const rec = viewerPhoto;
    if (!rec) return;
    useSettings.getState().setCustomWallpaper(rec.blob);
    setWallpaperOk(true);
    if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current);
    wallpaperTimerRef.current = window.setTimeout(() => setWallpaperOk(false), 1400);
  };

  /** 设为锁定屏幕壁纸：与主屏壁纸完全独立（store 的 lockWallpaper 键），复用同一 Blob 引用 */
  const handleSetLockWallpaper = () => {
    const rec = viewerPhoto;
    if (!rec) return;
    useSettings.getState().setLockCustomWallpaper(rec.blob);
    setLockWallpaperOk(true);
    if (lockWallpaperTimerRef.current !== null) window.clearTimeout(lockWallpaperTimerRef.current);
    lockWallpaperTimerRef.current = window.setTimeout(() => setLockWallpaperOk(false), 1400);
  };

  const handleDelete = async () => {
    const rec = viewerPhoto;
    if (!rec) return;
    if (!window.confirm('确定删除这张照片？删除后无法恢复。')) return;
    const next = visiblePhotos[viewerIdx + 1] ?? visiblePhotos[viewerIdx - 1] ?? null;
    setViewerId(next ? next.id : null);
    await localDB.delete('photos', rec.id);
    await pruneDeletedFromAlbums([rec.id]);
    setReloadKey((k) => k + 1);
  };

  /** 多选批量删除（图库上下文；相册详情内的多选只有「移出相册」） */
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`删除所选 ${ids.length} 张照片？删除后无法恢复。`)) return;
    setViewerId(null);
    setSelectMode(false);
    setSelectedIds(new Set());
    for (const id of ids) {
      try {
        await localDB.delete('photos', id);
      } catch {
        /* 忽略单条删除异常 */
      }
    }
    await pruneDeletedFromAlbums(ids);
    setReloadKey((k) => k + 1);
  };

  // 查看器手势：单击检测双击（放大/还原），横滑切换
  const handleStageTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const t = event.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleStageTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setZoomed((z) => !z);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
      return;
    }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      stepViewer(dx < 0 ? 1 : -1);
    }
  };

  // ---------------- 渲染 ----------------

  const navTitle = openAlbum
    ? openAlbum.name
    : activeTab === 'photos'
      ? '照片'
      : activeTab === 'albums'
        ? '相册'
        : '个人收藏';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        ref={scrollRef}
        className="flex h-full w-full flex-col overflow-y-auto overscroll-contain pb-[120px]"
      >
        {/* 大标题随内容滚动（static! 覆盖内置 sticky），分组头在状态栏下方吸顶 */}
        <IOSNavBar
          inline
          title={navTitle}
          className="static!"
          left={
            openAlbum ? (
              // 相册详情返回键（BackToHome 同款箭头样式），回相册 tab
              <button
                type="button"
                aria-label="返回相册列表"
                onClick={closeAlbumDetail}
                className="-ml-1 flex h-11 w-11 items-center justify-center text-foreground transition-opacity active:opacity-50"
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
              </button>
            ) : (
              <BackToHome className="static!" />
            )
          }
          right={
            openAlbum ? (
              selectMode ? (
                <IOSTextButton onClick={exitSelectMode}>完成</IOSTextButton>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="添加照片到相册"
                    onClick={openAlbumPicker}
                    className="text-foreground transition-opacity active:opacity-50"
                  >
                    <Plus className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                  <IOSTextButton onClick={enterSelectMode} disabled={albumPhotos.length === 0}>
                    选择
                  </IOSTextButton>
                </>
              )
            ) : activeTab === 'albums' ? (
              <>
                <button
                  type="button"
                  aria-label="新建相册"
                  onClick={startCreateAlbum}
                  className="text-foreground transition-opacity active:opacity-50"
                >
                  <Plus className="h-6 w-6" strokeWidth={2.2} />
                </button>
                <IOSTextButton
                  onClick={() => setAlbumsEditMode((v) => !v)}
                  disabled={albums.length === 0}
                >
                  {albumsEditMode ? '完成' : '编辑'}
                </IOSTextButton>
              </>
            ) : selectMode ? (
              <IOSTextButton onClick={exitSelectMode}>完成</IOSTextButton>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="从本地上传照片"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-foreground transition-opacity active:opacity-50"
                >
                  <Plus className="h-6 w-6" strokeWidth={2.2} />
                </button>
                <IOSTextButton onClick={enterSelectMode} disabled={visiblePhotos.length === 0}>
                  选择
                </IOSTextButton>
              </>
            )
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void handleUpload(e)}
        />

        {!loaded && (
          <div className="flex flex-1 items-center justify-center" aria-label="加载中">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
          </div>
        )}

        {/* ---------- 相册详情（覆盖三 tab 的二级页） ---------- */}
        {loaded && openAlbum && albumPhotos.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">没有照片</p>
            <p className="text-[13px] text-muted-foreground">点右上角「+」添加照片</p>
          </div>
        )}
        {loaded && openAlbum && albumPhotos.length > 0 && (
          <div className="grid grid-cols-3 gap-[2px] pt-[2px]">
            {albumPhotos.map((p) => (
              <PhotoTile
                key={p.id}
                photo={p}
                url={urls.get(p.id)}
                ariaLabel={
                  selectMode
                    ? `${selectedIds.has(p.id) ? '取消选择' : '选择'}照片 ${p.name}`
                    : `查看照片 ${p.name}`
                }
                selecting={selectMode}
                selected={selectedIds.has(p.id)}
                onClick={() => {
                  if (selectMode) toggleSelected(p.id);
                  else openViewer(p.id);
                }}
              />
            ))}
          </div>
        )}

        {/* ---------- 照片 / 收藏 tab：年月日分组图库 ---------- */}
        {/* #90：原 `activeTab !== 'albums' && activeTab === 'photos'` 冗余（=== 'photos' 已隐含 !== 'albums'），简化为单条件 */}
        {loaded && !openAlbum && activeTab === 'photos' && photos.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">没有照片</p>
            <p className="text-[13px] text-muted-foreground">从本地上传或使用相机拍摄</p>
          </div>
        )}
        {loaded && !openAlbum && activeTab === 'favorites' && visiblePhotos.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <Heart className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">没有收藏的照片</p>
            <p className="text-[13px] text-muted-foreground">查看照片时点击❤添加到个人收藏</p>
          </div>
        )}
        {loaded &&
          !openAlbum &&
          activeTab !== 'albums' &&
          yearGroups.map((yg) => (
            <section key={yg.key}>
              {/* 年份吸顶：20px 大字 + 数量副标题 */}
              <div className="sticky top-[54px] z-10 bg-background px-5 pb-1.5 pt-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[20px] font-bold leading-tight">{yg.label}</h2>
                  <span className="text-[13px] tabular-nums text-muted-foreground">{groupCount(yg.months)}张</span>
                </div>
              </div>

              {yg.months.map((mg) => (
                <section key={mg.key}>
                  {/* 月份吸顶（覆盖年份头，模拟 iOS 折叠效果） */}
                  <div className="sticky top-[54px] z-20 bg-background px-5 pb-1.5 pt-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-[15px] font-semibold">{mg.label}</h3>
                      <span className="text-[12px] tabular-nums text-muted-foreground">
                        {mg.days.reduce((k, dg) => k + dg.photos.length, 0)}张
                      </span>
                    </div>
                  </div>

                  {mg.days.map((dg) => (
                    <div key={dg.key} className="pb-4">
                      <div className="px-5 pb-1.5 pt-1 text-[13px] text-muted-foreground">{dg.label}</div>
                      <div className="grid grid-cols-3 gap-[2px]">
                        {dg.photos.map((p) => (
                          <PhotoTile
                            key={p.id}
                            photo={p}
                            url={urls.get(p.id)}
                            ariaLabel={
                              selectMode
                                ? `${selectedIds.has(p.id) ? '取消选择' : '选择'}照片 ${p.name}`
                                : `查看照片 ${p.name}`
                            }
                            selecting={selectMode}
                            selected={selectedIds.has(p.id)}
                            onClick={() => {
                              if (selectMode) toggleSelected(p.id);
                              else openViewer(p.id);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </section>
          ))}

        {/* ---------- 相册 tab：2 列相册网格 ---------- */}
        {loaded && !openAlbum && activeTab === 'albums' && albums.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <Images className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">没有相册</p>
            <p className="text-[13px] text-muted-foreground">点右上角「+」新建相册</p>
          </div>
        )}
        {loaded && !openAlbum && activeTab === 'albums' && albums.length > 0 && (
          <div className="grid grid-cols-2 gap-3 px-5 pt-2">
            {albums.map((alb) => {
              const valid = validAlbumPhotos(alb, photoMap);
              const cover = valid[0] ?? null;
              return (
                <div key={alb.id} className="relative">
                  <button
                    type="button"
                    aria-label={albumsEditMode ? `重新命名相册 ${alb.name}` : `打开相册 ${alb.name}`}
                    onClick={() => {
                      if (albumsEditMode) startRenameAlbum(alb);
                      else openAlbumDetail(alb.id);
                    }}
                    className="block w-full text-left transition-opacity active:opacity-70"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-muted">
                      {cover ? (
                        <img
                          src={urls.get(cover.id)}
                          alt={alb.name}
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full select-none object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                          <ImageIcon className="h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 truncate text-[15px] leading-tight">{alb.name}</div>
                    <div className="text-[13px] tabular-nums text-muted-foreground">{valid.length}张</div>
                  </button>
                  {/* 编辑模式：红色 − 删相册钮（独立按钮，避免嵌套 button） */}
                  {albumsEditMode && (
                    <button
                      type="button"
                      aria-label={`删除相册 ${alb.name}`}
                      onClick={() => void handleDeleteAlbum(alb)}
                      className="absolute -left-1.5 -top-1.5 z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#FF453A] text-white shadow-md transition-opacity active:opacity-70"
                    >
                      <Minus className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 状态栏底色遮罩：内容滚动时保持顶部 54px 干净 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[54px] bg-background" aria-hidden="true" />

      {/* 图库多选模式底部工具栏（照片/收藏 tab） */}
      {selectMode && !openAlbum && (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 pb-[28px] backdrop-blur-xl">
          <div className="flex h-[60px] items-center justify-between px-8">
            <button
              type="button"
              aria-label="分享所选照片"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchShare()}
              className="text-foreground transition-opacity active:opacity-50 disabled:opacity-30"
            >
              <Share2 className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </button>
            <span className="text-[15px] tabular-nums text-muted-foreground">已选 {selectedIds.size} 项</span>
            <button
              type="button"
              aria-label="删除所选照片"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchDelete()}
              className="text-[#FF453A] transition-opacity active:opacity-50 disabled:opacity-30"
            >
              <Trash2 className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      )}

      {/* 相册详情多选底部工具栏：只有「移出相册」，不删照片本体 */}
      {selectMode && openAlbum && (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 pb-[28px] backdrop-blur-xl">
          <div className="flex h-[60px] items-center justify-between px-8">
            <button
              type="button"
              aria-label="将所选照片移出相册"
              disabled={selectedIds.size === 0}
              onClick={() => void handleRemoveFromAlbum()}
              className="text-[15px] text-[#FF453A] transition-opacity active:opacity-50 disabled:opacity-30"
            >
              移出相册
            </button>
            <span className="text-[15px] tabular-nums text-muted-foreground">已选 {selectedIds.size} 项</span>
            <button
              type="button"
              aria-label="取消多选"
              onClick={exitSelectMode}
              className="text-[15px] text-foreground transition-opacity active:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 全屏「添加照片」选择器（相册详情 → Plus；已在相册的默认勾选，可取消） */}
      {pickerOpen && openAlbum && (
        <div
          className="absolute inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label={`添加照片到相册 ${openAlbum.name}`}
        >
          <div className="h-[54px] shrink-0" aria-hidden="true" />
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-4">
            <button
              type="button"
              aria-label="取消添加照片"
              onClick={() => setPickerOpen(false)}
              className="text-[15px] text-foreground transition-opacity active:opacity-50"
            >
              取消
            </button>
            <span className="text-[15px] font-semibold tabular-nums">已选 {pickerIds.size} 项</span>
            <button
              type="button"
              aria-label="保存相册照片"
              onClick={() => void confirmAlbumPicker()}
              className="text-[15px] font-semibold text-[#0A84FF] transition-opacity active:opacity-50"
            >
              完成
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {photos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
                <ImageIcon className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-[15px] text-muted-foreground">没有照片可添加</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-[2px] pt-[2px]">
                {photos.map((p) => (
                  <PhotoTile
                    key={p.id}
                    photo={p}
                    url={urls.get(p.id)}
                    ariaLabel={`${pickerIds.has(p.id) ? '取消勾选' : '勾选'}照片 ${p.name}`}
                    selecting
                    selected={pickerIds.has(p.id)}
                    onClick={() => togglePickerPhoto(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 全屏照片查看器（黑色背景，仅查看场景） */}
      {viewerPhoto && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black" role="dialog" aria-label="照片查看器">
          {/* 图片舞台：滑动切换 / 双击缩放 */}
          <div
            className="absolute inset-0 touch-none select-none"
            onTouchStart={handleStageTouchStart}
            onTouchEnd={handleStageTouchEnd}
            onDoubleClick={() => setZoomed((z) => !z)}
          >
            <img
              key={viewerPhoto.id}
              src={urls.get(viewerPhoto.id)}
              alt={viewerPhoto.name}
              draggable={false}
              className={`h-full w-full object-contain transition-transform duration-300 ease-out ${
                zoomed ? 'scale-[2]' : 'scale-100'
              }`}
            />
          </div>

          {/* 顶部：返回 + 照片日期 */}
          <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-4">
            <div className="h-[54px]" />
            <div className="relative flex h-11 items-center px-2">
              <button
                type="button"
                aria-label="返回照片"
                onClick={() => setViewerId(null)}
                className="rounded-full p-1.5 text-white transition-opacity active:opacity-50"
              >
                <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
              </button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-medium text-white">
                {photoViewerDate(viewerPhoto.createdAt)}
              </div>
              <div className="w-10" aria-hidden="true" />
            </div>
          </div>

          {/* 桌面端左右切换箭头（边界以当前上下文列表为准） */}
          <button
            type="button"
            aria-label="上一张"
            disabled={viewerIdx <= 0}
            onClick={() => stepViewer(-1)}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={viewerIdx >= visiblePhotos.length - 1}
            onClick={() => stepViewer(1)}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* "更多"操作菜单（含设为壁纸 / 设为锁定屏幕） */}
          {moreOpen && (
            <>
              <div className="absolute inset-0 z-20" aria-hidden="true" onClick={() => setMoreOpen(false)} />
              <div className="absolute inset-x-0 bottom-[108px] z-30 flex justify-center px-10">
                <div className="w-full max-w-[260px] overflow-hidden rounded-[14px] border border-white/10 bg-[#2C2C2E]/95 shadow-2xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={handleSetWallpaper}
                    className="flex h-12 w-full items-center gap-3 border-b border-white/10 px-4 text-[15px] text-white transition-colors active:bg-white/10"
                  >
                    <Wallpaper className="h-[18px] w-[18px] opacity-80" />
                    <span className="flex-1 text-left">设为壁纸</span>
                    {wallpaperOk && <Check className="h-4 w-4 text-[#30D158]" strokeWidth={3} />}
                  </button>
                  <button
                    type="button"
                    data-testid="lock-wallpaper-item"
                    onClick={handleSetLockWallpaper}
                    className="flex h-12 w-full items-center gap-3 border-b border-white/10 px-4 text-[15px] text-white transition-colors active:bg-white/10"
                  >
                    <LockKeyhole className="h-[18px] w-[18px] opacity-80" />
                    <span className="flex-1 text-left">设为锁定屏幕</span>
                    {lockWallpaperOk && <Check className="h-4 w-4 text-[#30D158]" strokeWidth={3} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    className="flex h-12 w-full items-center justify-center text-[15px] text-white/90 transition-colors active:bg-white/10"
                  >
                    取消
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 底部操作栏：分享/收藏/删除/更多 圆形按钮（避开 Home 热区） */}
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-6 pb-[44px]">
            <div className="flex items-center justify-around px-6">
              <button
                type="button"
                aria-label="分享照片"
                onClick={() => void handleShare()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Share2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label={hearted ? '取消收藏' : '收藏照片'}
                aria-pressed={hearted}
                onClick={() => void toggleFavorite()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Heart
                  className={`h-[21px] w-[21px] ${hearted ? 'fill-[#FF453A] text-[#FF453A]' : ''}`}
                  strokeWidth={1.9}
                />
              </button>
              <button
                type="button"
                aria-label="删除照片"
                onClick={() => void handleDelete()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label="更多操作"
                onClick={() => setMoreOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建/重命名相册弹窗（iOS 风格居中卡片） */}
      {albumDialog && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 px-10 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={albumDialog.mode === 'rename' ? '重新命名相册' : '新建相册'}
        >
          <div className="w-full max-w-[270px] overflow-hidden rounded-[14px] bg-background shadow-2xl">
            <div className="px-4 pb-4 pt-5">
              <h2 className="text-center text-[17px] font-semibold">
                {albumDialog.mode === 'rename' ? '重新命名' : '新建相册'}
              </h2>
              <label htmlFor="album-name-input" className="sr-only">
                相册名称
              </label>
              <input
                id="album-name-input"
                type="text"
                value={albumNameDraft}
                onChange={(e) => setAlbumNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmAlbumDialog();
                }}
                autoFocus
                placeholder="相册名称"
                className="mt-3 h-10 w-full rounded-[10px] border border-border bg-muted/30 px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-[#0A84FF]"
              />
            </div>
            <div className="flex border-t border-border/60 text-[17px]">
              <button
                type="button"
                aria-label="取消"
                onClick={() => setAlbumDialog(null)}
                className="flex-1 border-r border-border/60 py-3 text-foreground transition-colors active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                aria-label={albumDialog.mode === 'rename' ? '存储相册名称' : '创建相册'}
                disabled={albumNameDraft.trim().length === 0}
                onClick={() => void confirmAlbumDialog()}
                className="flex-1 py-3 font-semibold text-[#0A84FF] transition-colors active:bg-black/5 disabled:opacity-40 dark:active:bg-white/10"
              >
                {albumDialog.mode === 'rename' ? '存储' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部毛玻璃胶囊三 tab（二级页/查看器/多选/选择器打开时收起） */}
      {capsuleVisible && (
        <nav
          aria-label="相册分区"
          className="absolute bottom-[34px] left-1/2 z-30 -translate-x-1/2 rounded-full border border-black/10 bg-white/60 p-1 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-[#2C2C2E]/60"
        >
          <div className="flex items-center">
            {ALBUM_TABS.map((tab) => {
              const TabIcon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  aria-label={tab.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => switchTab(tab.key)}
                  className={`flex items-center gap-1 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                    active ? 'bg-black/10 text-foreground dark:bg-white/15' : 'text-muted-foreground'
                  }`}
                >
                  <TabIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
