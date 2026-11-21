'use client';

/**
 * 相册页（AI 视觉管理 UI）：
 * - 按 contactId 隔离的图片网格（3 列 aspect-square）；
 * - 全屏查看器：左右滑切换 / 单张删除 / 编辑描述 / （可选）onPick 回调供上层用作头像/背景选择；
 * - 多选模式：右上「选择」→ 缩略图右上角勾选圈 → 底部「删除」按钮；
 * - 添加图片：右上 + → 隐藏 file input（accept="image/*" multiple）→ canvas 压缩到 1280px JPEG 0.8 → addAlbum。
 *
 * 数据层由 46-a 实现的 album-store CRUD 提供（IndexedDB albums 表，按 contactId 索引）。
 * 视觉风格参考 src/components/apps/photos.tsx，简化为单层网格 + 查看器两层。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type TouchEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { IOSNavBar, IOSScreen, IOSTextButton } from '@/components/ios/IOSNavBar';
import { listAlbums, addAlbum, updateAlbum, deleteAlbum } from '@/lib/ios/album-store';
import { describeAlbumEntry } from '@/lib/ios/album-vision';
import type { AlbumRecord } from '@/lib/ios/db';

export interface AlbumPageProps {
  /** 相册所属联系人 ID（按角色隔离，与 album-store contactId 一致） */
  contactId: string;
  /** 导航栏标题：「我的相册」 / "${peerName}的相册" */
  title: string;
  /** 返回上层（关闭相册 App） */
  onClose: () => void;
  /** true = 用户可添加/删除/编辑（默认 true）；false = 只读浏览（用于查看 peer 相册） */
  allowEdit?: boolean;
  /** 可选：选择模式回调——查看器底部「选这张」按钮，上层据此设头像/背景或挑图发送 */
  onPick?: (albumId: string) => void;
  /** 可选：轻提示通道（上传失败/成功反馈用；第二十九轮：不再静默吞掉失败——
   *  微信/QQ 侧传入各自的 showToast，之前「上传了没反应」的观感大多就是失败被吞） */
  onToast?: (m: string) => void;
}

/** 读图片文件并 canvas 压缩到最大边 max px 的 JPEG data URL（quality 0.8）。
 *  album-store 的 src 字段是 data URL 字符串（不是 Blob），故与 photos.tsx 的 File 直存不同，这里需读+压缩+toDataURL。
 *  第二十九轮修复「上传不了图片」：先快照 FileList 再清 input.value（规范里 value='' 会原地清空 FileList）。
 *  第三十轮修复「上传的图片不显示」根因：此前 canvas 解码失败（iPhone HEIC/冷门格式）时回退存原始
 *  dataURL——但 Image 已经 onerror 说明本浏览器根本无法解码该格式，存进去的就是一张永远显示不出来的
 *  死图（网格里空白瓦片）= 用户看到的「上传成功但不显示」。现改为三级解码：Image → createImageBitmap
 *  （支持面更广，部分平台能解 HEIC）→ 都失败才明确 reject（有 toast 反馈，绝不再存不可显示的死图）；
 *  Image 成功但 canvas 失败时才允许存原始 dataURL（此时浏览器已证明能渲染，显示无问题）。 */
// NOTE: wechat.tsx readImageFile（max=720）同款三级解码已同步，未来可抽到 src/lib/ios/image-compress.ts 共用
function readImageFile(file: File, max = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      // 兑底：仅当浏览器已证明能解码（Image 成功但 canvas 失败）时才存原始 dataURL
      const viaRaw = () => {
        if (raw.startsWith('data:image/')) resolve(raw);
        else reject(new Error('不支持的图片格式'));
      };
      // 二次解码：createImageBitmap 支持面比 <img> 更广（部分平台能解 HEIC/EXIF 变体），成功仍走 canvas 压缩
      const viaBitmap = () => {
        if (typeof createImageBitmap !== 'function') {
          reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG'));
          return;
        }
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then((bmp) => {
            try {
              const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(bmp.width * scale));
              canvas.height = Math.max(1, Math.round(bmp.height * scale));
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('图片解析失败'));
                return;
              }
              // 白底填底，避免透明图转 JPEG 后变黑底
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
              try {
                bmp.close();
              } catch {
                /* close 失败不影响 */
              }
              const out = canvas.toDataURL('image/jpeg', 0.8);
              if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
              else reject(new Error('图片解析失败'));
            } catch {
              reject(new Error('图片解析失败'));
            }
          })
          .catch(() => reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG')));
      };
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            viaRaw();
            return;
          }
          // 白底填底，避免透明 PNG 转 JPEG 后变黑底（#118）
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', 0.8);
          if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
          else viaRaw();
        } catch {
          viaRaw();
        }
      };
      img.onerror = () => viaBitmap();
      img.src = raw;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 轻提示自动消失时长（ms） */
const TOAST_MS = 1600;

export default function AlbumPage({
  contactId,
  title,
  onClose,
  allowEdit = true,
  onPick,
  onToast,
}: AlbumPageProps) {
  const [items, setItems] = useState<AlbumRecord[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 当前查看的 items 索引；null = 关闭查看器 */
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  /** 编辑描述弹窗：null 关闭 / string 当前编辑的 albumId */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  /** 浏览器渲染失败的条目（历史遗留 HEIC 等死图）：网格/查看器显示「无法显示」占位而非空白 */
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  /** 页内轻提示：微信/QQ 宿主都在相册页早退返回本组件、宿主级 Toast 不挂载
   *  （上传成功/失败此前完全没有可见反馈），故在本页内置一份展示；
   *  onToast 照常回调不破坏既有接口 */
  const [localToast, setLocalToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      setLocalToast(msg);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setLocalToast(''), TOAST_MS);
      onToast?.(msg);
    },
    [onToast],
  );

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const markBroken = useCallback((id: string) => {
    setBrokenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  /** 加载相册列表（按 createdAt 升序，listAlbums 已排好） */
  const reload = useCallback(async () => {
    const list = await listAlbums(contactId);
    setItems(list);
  }, [contactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ---------------- 添加 ----------------

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    // 【第二十九轮根因修复】相册上传不了的真正原因：先捕获 e.target.files 引用再清 input.value，
    // 而浏览器规范是 value='' 会「原地清空」该 FileList（实测 captured.length 1→0）——
    // 于是 files.length === 0 恒成立，上传永远静默返回。修复：先用 Array.from 快照（照片 App
    // 一直用的就是这个安全模式，所以照片 App 能传、相册不能），再做后续一切。
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setAdding(true);
    let ok = 0;
    let fail = 0;
    const added: { id: string; src: string }[] = [];
    try {
      for (const f of Array.from(files)) {
        // MIME 缺失（部分安卓/iOS 分享出来的文件 type 为空）不再直接丢弃：按扩展名兜底判断（第二十九轮）
        const looksImage = f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name);
        if (!looksImage) {
          fail += 1;
          continue;
        }
        try {
          const src = await readImageFile(f);
          const rec = await addAlbum(contactId, src, { origin: 'user', name: f.name });
          ok += 1;
          if (rec) added.push({ id: rec.id, src });
        } catch {
          // 单张失败不阻塞后续，但不再静默：计数后统一提示
          fail += 1;
        }
      }
      if (ok > 0 && fail > 0) showToast(`已添加 ${ok} 张，${fail} 张失败（可能是格式不支持）`);
      else if (ok > 0) showToast(`已添加 ${ok} 张图片`);
      else if (fail > 0) showToast('图片添加失败，可能是格式不支持（如 HEIC 请先转 JPG）');
      await reload();
      // 自动识图描述（第二十九轮「让 AI 知道相册里的图片长什么样」）：
      // 上传成功后逐张后台识图回写 desc（fire-and-forget；未配置识图模型自动用内置兑底），
      // 之后 AI 的【相册清单】里就是真实内容简述，能据此主动分享/聊图
      for (const a of added) {
        void describeAlbumEntry(a.id, a.src);
      }
    } finally {
      setAdding(false);
    }
  };

  // ---------------- 选择/删除 ----------------

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`确定删除 ${ids.length} 张图片？`)) return;
    for (const id of ids) {
      try {
        await deleteAlbum(id);
      } catch {
        /* 忽略单条失败 */
      }
    }
    exitSelectMode();
    await reload();
  };

  const handleDeleteOne = async (id: string) => {
    if (!window.confirm('确定删除这张图片？')) return;
    try {
      await deleteAlbum(id);
    } catch {
      /* 忽略 */
    }
    // 查看器内删除：尝试跳到相邻张；列表为空则关查看器
    if (items) {
      const remaining = items.filter((a) => a.id !== id);
      if (viewerIdx !== null) {
        const newIdx = Math.min(viewerIdx, remaining.length - 1);
        setViewerIdx(newIdx >= 0 ? newIdx : null);
      }
    }
    await reload();
  };

  // ---------------- 查看器交互 ----------------

  const openViewer = (idx: number) => {
    setViewerIdx(idx);
  };

  const closeViewer = () => setViewerIdx(null);

  const stepViewer = (delta: number) => {
    if (viewerIdx === null || !items) return;
    const next = viewerIdx + delta;
    if (next < 0 || next >= items.length) return;
    setViewerIdx(next);
  };

  const handleStageTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleStageTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      stepViewer(dx < 0 ? 1 : -1);
    }
  };

  // ---------------- 编辑描述 ----------------

  const startEdit = (rec: AlbumRecord) => {
    setEditingId(rec.id);
    setDescDraft(rec.desc ?? '');
  };

  const confirmEdit = async () => {
    if (editingId === null) return;
    const text = descDraft.trim();
    try {
      await updateAlbum(editingId, { desc: text || undefined });
    } catch {
      /* 忽略 */
    }
    setEditingId(null);
    setDescDraft('');
    await reload();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDescDraft('');
  };

  // ---------------- 渲染 ----------------

  const current = viewerIdx !== null && items ? items[viewerIdx] ?? null : null;
  const isEmpty = items !== null && items.length === 0;

  return (
    <IOSScreen className="relative">
      <IOSNavBar
        inline
        title={title}
        className="static!"
        left={
          <button
            type="button"
            aria-label="返回"
            onClick={onClose}
            className="-ml-1 flex h-11 w-11 items-center justify-center text-foreground transition-opacity active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
        }
        right={
          allowEdit ? (
            selectMode ? (
              <IOSTextButton onClick={exitSelectMode}>完成</IOSTextButton>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="添加图片"
                  onClick={() => fileRef.current?.click()}
                  disabled={adding}
                  className="text-foreground transition-opacity active:opacity-50 disabled:opacity-40"
                >
                  {adding ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-6 w-6" strokeWidth={2.2} />}
                </button>
                <IOSTextButton
                  onClick={() => {
                    setSelectMode(true);
                    setSelected(new Set());
                  }}
                  disabled={items === null || items.length === 0}
                >
                  选择
                </IOSTextButton>
              </>
            )
          ) : undefined
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void handleUpload(e)}
      />

      {/* 主体滚动区 */}
      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        {/* 加载态 */}
        {items === null && (
          <div className="flex h-full items-center justify-center" aria-label="加载中">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* 空态 */}
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <ImageOff className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">暂无图片</p>
            <p className="text-[13px] text-muted-foreground">
              {allowEdit ? '点击右上角 + 添加图片' : '该相册暂无图片'}
            </p>
          </div>
        )}

        {/* 网格视图 */}
        {items !== null && items.length > 0 && (
          <div className="grid grid-cols-3 gap-1 p-1">
            {items.map((rec, idx) => {
              const isSel = selected.has(rec.id);
              return (
                <button
                  key={rec.id}
                  type="button"
                  aria-label={rec.name || rec.desc || `图片 ${idx + 1}`}
                  onClick={() => {
                    if (selectMode) toggleSelect(rec.id);
                    else openViewer(idx);
                  }}
                  className="relative block aspect-square w-full overflow-hidden bg-muted transition-opacity active:opacity-80"
                >
                  {brokenIds.has(rec.id) ? (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted">
                      <ImageOff className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
                      <span className="text-[10px] text-muted-foreground/70">无法显示</span>
                    </span>
                  ) : (
                    <img
                      src={rec.src}
                      alt={rec.desc ?? rec.name ?? ''}
                      loading="lazy"
                      draggable={false}
                      onError={() => markBroken(rec.id)}
                      className="h-full w-full select-none object-cover"
                    />
                  )}
                  {selectMode && (
                    <span
                      className={`absolute left-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] backdrop-blur-sm transition-colors ${
                        isSel ? 'border-foreground bg-foreground' : 'border-white/90 bg-black/25'
                      }`}
                    >
                      {isSel && <Check className="h-3.5 w-3.5 text-background" strokeWidth={3.5} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 多选底部删除栏 */}
      {selectMode && items && items.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 pb-[28px] backdrop-blur-xl">
          <div className="flex h-14 items-center justify-center px-6">
            <button
              type="button"
              onClick={handleBatchDelete}
              disabled={selected.size === 0}
              className="flex items-center gap-2 text-[17px] text-[#FF453A] transition-opacity active:opacity-50 disabled:opacity-40"
            >
              <Trash2 className="h-5 w-5" />
              删除{selected.size > 0 ? `（${selected.size}）` : ''}
            </button>
          </div>
        </div>
      )}

      {/* 查看器 */}
      {current && items && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black" role="dialog" aria-label="图片查看器">
          {/* 图片舞台 */}
          <div
            className="absolute inset-0 touch-none select-none"
            onTouchStart={handleStageTouchStart}
            onTouchEnd={handleStageTouchEnd}
          >
            {brokenIds.has(current.id) ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-10 text-center">
                <ImageOff className="h-10 w-10 text-white/40" aria-hidden="true" />
                <p className="text-[14px] text-white/70">这张图片的格式当前浏览器无法显示</p>
              </div>
            ) : (
              <img
                key={current.id}
                src={current.src}
                alt={current.desc ?? current.name ?? ''}
                draggable={false}
                onError={() => markBroken(current.id)}
                className="h-full w-full select-none object-contain"
              />
            )}
          </div>

          {/* 顶部栏：关闭 + 当前序号 */}
          <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-4">
            <div className="h-[54px]" />
            <div className="relative flex h-11 items-center px-2">
              <button
                type="button"
                aria-label="关闭查看器"
                onClick={closeViewer}
                className="rounded-full p-1.5 text-white transition-opacity active:opacity-50"
              >
                <X className="h-6 w-6" strokeWidth={2.5} />
              </button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-medium text-white">
                {viewerIdx !== null ? `${viewerIdx + 1} / ${items.length}` : ''}
              </div>
              <div className="ml-auto flex items-center gap-2 pr-1">
                {allowEdit && (
                  <>
                    <button
                      type="button"
                      aria-label="编辑描述"
                      onClick={() => startEdit(current)}
                      className="rounded-full p-1.5 text-white transition-opacity active:opacity-50"
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => void handleDeleteOne(current.id)}
                      className="rounded-full p-1.5 text-white transition-opacity active:opacity-50"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 桌面端左右切换箭头 */}
          <button
            type="button"
            aria-label="上一张"
            disabled={viewerIdx === null || viewerIdx <= 0}
            onClick={() => stepViewer(-1)}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={viewerIdx === null || viewerIdx >= items.length - 1}
            onClick={() => stepViewer(1)}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* 底部：描述 + 可选「选这张」按钮（onPick 存在时） */}
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-6 pt-6 pb-[44px]">
            {current.desc && (
              <p className="mb-3 text-center text-[14px] leading-relaxed text-white/90 line-clamp-3">
                {current.desc}
              </p>
            )}
            {onPick && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => onPick(current.id)}
                  className="rounded-full bg-white/15 px-6 py-2.5 text-[15px] font-medium text-white backdrop-blur-md transition-opacity active:opacity-70"
                >
                  选这张
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 编辑描述弹窗 */}
      {editingId !== null && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 px-10 backdrop-blur-sm"
          role="dialog"
          aria-label="编辑描述"
        >
          <div className="w-full max-w-[320px] overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-2xl">
            <div className="border-b border-border/60 px-4 py-3 text-center text-[15px] font-semibold">
              编辑描述
            </div>
            <div className="px-4 py-4">
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="为这张图片添加描述（可选）"
                rows={4}
                maxLength={200}
                autoFocus
                className="w-full resize-none rounded-[10px] border border-border/60 bg-muted/40 px-3 py-2 text-[15px] outline-none focus:border-foreground/40"
              />
              <div className="mt-1 text-right text-[12px] text-muted-foreground">
                {descDraft.length}/200
              </div>
            </div>
            <div className="flex border-t border-border/60">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex-1 py-3 text-[16px] text-foreground transition-colors active:bg-muted/60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmEdit()}
                className="flex-1 border-l border-border/60 py-3 text-[16px] font-semibold text-[#007AFF] transition-colors active:bg-muted/60"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 页内轻提示（上传成功/失败等；宿主 Toast 在相册页不挂载，必须自渲染） */}
      {localToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-1/2 z-[80] -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white"
        >
          {localToast}
        </div>
      )}
    </IOSScreen>
  );
}
