'use client';

/**
 * 网上表情包搜索面板（微信 / QQ 表情面板共用，Task 29 修订）——「替换式」布局：
 *  - 打开时整个替换表情面板本体（原面板头部/分组栏/网格卸载），本面板占据面板原位置
 *    （同宽同高、贴输入栏上方），关闭/选中后恢复原面板；不再是盖在消息区上的浮层
 *  - 高度由父级容器在打开瞬间实测传入（offsetHeight 即壳本地 px，transform 不影响 offsetHeight），
 *    本组件 h-full 铺满即可，无需再量壳几何
 *  - 顶栏：收起箭头 + 居中「表情搜索」标题；搜索框「搜索或合成表情」回车或 400ms 防抖实时搜
 *  - 「最近在搜」标签（localStorage 按端隔离，无历史时显示真机预设词组；垃圾桶清空）
 *  - 结果网格滚动展示全部搜索结果（缩略图挂了自动退回原图，再挂自动移除该格——
 *    网格里看到的全是能正常显示的表情，不留空白格）
 *  - 点选结果即发送；长按结果 → 预览卡（大图 + 发送 + 添加到表情）：
 *    「添加到表情」保存到我的表情（默认分组，原图探活失败自动退缩略图）；已保存过的显示「已保存」
 *
 * 数据源在后端 /api/sticker-search（360 图片 + 发表情兜底 + 24h 缓存）；图片走 /api/sticker-image 防盗链代理。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { DEFAULT_STICKER_GROUP_ID, newStickerId, type Sticker } from '@/lib/ios/stickers';

/** 真机微信冷启动预设词（无搜索历史时展示） */
const PRESET_TAGS = ['我自己玩', '哈喽哈喽', '救你了', 'mua', '服侍', '抱抱', 'Q', '哭', '不要'];

const HIST_KEY = (app: 'wx' | 'qq') => `${app}-sticker-search-hist`;
const HIST_CAP = 12;

interface StickerHit {
  thumb: string;
  image: string;
}

/** 图片探活：timeout 内能加载 = 有效（用于「存原图保动画，死了退缩略图」决策） */
function probeImage(url: string, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(false), timeout);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}

/**
 * 单个结果瓦片：
 *  - 点击 = 发送；缩略图加载失败自动退回原图，原图也挂则上报父级移除（网格不出现空白格）
 *  - 长按 450ms = 打开预览卡（添加到表情），触发后抑制随后的 click 发送
 */
function HitCell({
  app,
  index,
  hit,
  onPick,
  onDead,
  onLongPress,
}: {
  app: 'wx' | 'qq';
  index: number;
  hit: StickerHit;
  onPick: (h: StickerHit) => void;
  onDead: (i: number) => void;
  onLongPress: (h: StickerHit, i: number) => void;
}) {
  const [src, setSrc] = useState(hit.thumb);
  const pressTimerRef = useRef<number | null>(null);
  const suppressSendRef = useRef(false);
  const clearPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  useEffect(() => () => clearPress(), []);
  return (
    <button
      type="button"
      data-testid={`${app}-sticker-search-item-${index}`}
      onClick={() => {
        if (suppressSendRef.current) {
          suppressSendRef.current = false;
          return;
        }
        onPick(hit);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        clearPress();
        pressTimerRef.current = window.setTimeout(() => {
          pressTimerRef.current = null;
          suppressSendRef.current = true;
          onLongPress(hit, index);
        }, 450);
      }}
      onPointerMove={(e) => {
        if (!pressTimerRef.current) return;
        const t = e.currentTarget as HTMLElement;
        const r = t.getBoundingClientRect();
        if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) clearPress();
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      className="aspect-square overflow-hidden rounded-[10px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:opacity-60 dark:bg-white/10"
    >
      <img
        src={src}
        alt={`表情 ${index + 1}`}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => {
          if (src !== hit.image) setSrc(hit.image);
          else onDead(index);
        }}
      />
    </button>
  );
}

export function StickerSearchSheet({
  app,
  onClose,
  onSend,
  onAdd,
  isSaved,
  onToast,
}: {
  app: 'wx' | 'qq';
  onClose: () => void;
  /** 点选结果即发送（临时 Sticker；发送链路自带面板收起） */
  onSend: (s: Sticker) => void;
  /** 长按预览卡「添加到表情」：保存进该端「我的表情」（默认分组；面板 commit 入库） */
  onAdd: (s: Sticker) => void;
  /** 该 url 是否已在「我的表情」里（预览卡据此显示「已保存」） */
  isSaved: (url: string) => boolean;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StickerHit[]>([]);
  /** 已确认缩略图/原图都挂掉的结果下标 → 从网格移除，保证展示的全是有效图 */
  const [dead, setDead] = useState<Record<number, true>>({});
  /** 本次会话里已保存过的结果下标（保存成功即时翻转预览卡为「已保存」） */
  const [added, setAdded] = useState<Record<number, true>>({});
  /** 长按预览卡（大图 + 发送/添加到表情/已保存） */
  const [preview, setPreview] = useState<{ hit: StickerHit; index: number; meaning: string } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [hist, setHist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HIST_KEY(app));
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, HIST_CAP) : [];
    } catch {
      return [];
    }
  });
  const [errText, setErrText] = useState('搜索失败，换个词试试');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  /** 挂载即聚焦输入框（preventScroll：绝不因 focus 滚动裁剪容器把面板顶出屏幕） */
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 180);
    return () => window.clearTimeout(t);
  }, []);

  /** 卸载清理防抖 */
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const pushHist = useCallback(
    (word: string) => {
      setHist((prev) => {
        const next = [word, ...prev.filter((x) => x !== word)].slice(0, HIST_CAP);
        try {
          localStorage.setItem(HIST_KEY(app), JSON.stringify(next));
        } catch {
          /* 配额满忽略 */
        }
        return next;
      });
    },
    [app],
  );

  const runSearch = useCallback(
    async (word: string) => {
      const kw = word.trim().slice(0, 30);
      if (!kw) return;
      const seq = ++seqRef.current;
      setPhase('loading');
      setDead({});
      setAdded({});
      setPreview(null);
      setErrText('搜索失败，换个词试试');
      try {
        const res = await fetch(`/api/sticker-search?q=${encodeURIComponent(kw)}`);
        const data = (await res.json()) as { ok?: boolean; items?: StickerHit[]; error?: string };
        if (seq !== seqRef.current) return; // 已被更新的搜索取代
        if (!res.ok || !data.ok || !Array.isArray(data.items) || data.items.length === 0) {
          setErrText(data.error || '没搜到相关表情，换个词试试');
          setPhase('error');
          return;
        }
        setHits(data.items);
        setPhase('done');
        pushHist(kw);
      } catch {
        if (seq !== seqRef.current) return;
        setErrText('网络不佳，搜索失败');
        setPhase('error');
      }
    },
    [pushHist],
  );

  /** 输入防抖实时搜（400ms；回车立即搜） */
  const onInput = (v: string) => {
    setQ(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const kw = v.trim();
    if (!kw) {
      setPhase('idle');
      setHits([]);
      setDead({});
      setAdded({});
      setPreview(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => void runSearch(kw), 400);
  };

  const pick = (h: StickerHit) => {
    onClose();
    // 原图可能已失效（搜索引擎索引滞后，直链 404）：发送前 2s 探活，失败退回网格缩略图
    //（360 结果缩略图固定在 qhimgs CDN，稳定在线；动图原图探活成功仍优先原图，保住 GIF 动画）
    const base = {
      id: `${app}ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      meaning: q.trim().slice(0, 30),
      groupId: DEFAULT_STICKER_GROUP_ID,
      createdAt: Date.now(),
    };
    void probeImage(h.image).then((alive) => onSend({ ...base, url: alive ? h.image : h.thumb }));
  };

  /** 长按 → 添加到「我的表情」：原图探活失败自动退缩略图；保存后面板列表入库 */
  const addToStickers = (h: StickerHit, index: number, meaning: string) => {
    const finish = (url: string) => {
      onAdd({
        id: newStickerId(),
        url,
        meaning,
        groupId: DEFAULT_STICKER_GROUP_ID,
        createdAt: Date.now(),
      });
      setAdded((prev) => ({ ...prev, [index]: true }));
      onToast('已添加到我的表情');
    };
    void probeImage(h.image).then((alive) => finish(alive ? h.image : h.thumb));
  };

  const clearHist = () => {
    setHist([]);
    try {
      localStorage.removeItem(HIST_KEY(app));
    } catch {
      /* 忽略 */
    }
  };

  const alive = hits.filter((_, i) => !dead[i]);
  const previewSaved = preview ? Boolean(added[preview.index]) || isSaved(preview.hit.image) || isSaved(preview.hit.thumb) : false;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-[#F7F7F7] dark:bg-[#232428]"
      style={{ animation: 'quick-in-up 0.22s ease-out' }}
      data-testid={`${app}-sticker-search-sheet`}
    >
      {/* 顶栏：收起箭头 + 居中标题 */}
      <div className="relative flex shrink-0 items-center justify-center px-3 pb-1 pt-3.5">
        <button
          type="button"
          aria-label="收起表情搜索"
          data-testid={`${app}-sticker-search-close`}
          onClick={onClose}
          className="absolute left-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/55 active:opacity-60 dark:bg-white/10 dark:text-white/60"
        >
          <ChevronDown className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-black/90 dark:text-white/90">表情搜索</p>
      </div>
      {/* 搜索框 */}
      <div className="shrink-0 px-4 pt-2.5">
        <div className="flex h-10 items-center gap-2 rounded-[10px] bg-black/[0.05] px-3 dark:bg-white/10">
          <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (debounceRef.current) window.clearTimeout(debounceRef.current);
                void runSearch(q);
              }
            }}
            placeholder="搜索或合成表情"
            enterKeyHint="search"
            className="w-full bg-transparent text-[15px] text-black/85 outline-none placeholder:text-black/30 dark:text-white/90 dark:placeholder:text-white/30"
            data-testid={`${app}-sticker-search-input`}
          />
        </div>
      </div>
      {/* 主体：最近在搜 / 结果（滚动展示全部结果） */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-3.5">
        {phase === 'idle' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-black/40 dark:text-white/40">最近在搜</p>
              {hist.length > 0 && (
                <button
                  type="button"
                  aria-label="清空搜索历史"
                  data-testid={`${app}-sticker-search-clear`}
                  onClick={clearHist}
                  className="text-black/30 active:opacity-60 dark:text-white/35"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {(hist.length > 0 ? hist : PRESET_TAGS).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`${app}-sticker-search-tag-${t}`}
                  onClick={() => {
                    setQ(t);
                    void runSearch(t);
                  }}
                  className="rounded-[10px] bg-white px-4 py-2.5 text-[14px] text-black/85 shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:opacity-60 dark:bg-white/10 dark:text-white/90"
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
        {phase === 'loading' && (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-black/40 dark:text-white/40">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[13px]">正在搜罗全网表情…</p>
          </div>
        )}
        {phase === 'error' && (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <p className="text-[13px] text-black/45 dark:text-white/45">{errText}</p>
            <button
              type="button"
              onClick={() => void runSearch(q)}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] text-black/70 shadow-sm active:opacity-60 dark:bg-white/10 dark:text-white/70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        )}
        {phase === 'done' && alive.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {alive.map((h) => {
              const i = hits.indexOf(h);
              return (
                <HitCell
                  key={`${h.image}-${i}`}
                  app={app}
                  index={i}
                  hit={h}
                  onPick={pick}
                  onDead={(di) => setDead((prev) => ({ ...prev, [di]: true }))}
                  onLongPress={(hit, hi) => setPreview({ hit, index: hi, meaning: q.trim().slice(0, 30) })}
                />
              );
            })}
          </div>
        )}
        {phase === 'done' && alive.length === 0 && (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <p className="text-[13px] text-black/45 dark:text-white/45">结果图片都失效了，换个词试试</p>
            <button
              type="button"
              onClick={() => void runSearch(q)}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] text-black/70 shadow-sm active:opacity-60 dark:bg-white/10 dark:text-white/70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        )}
      </div>

      {/* 长按预览卡（真微信同款：白卡大图 + 发送/添加到表情；已保存显示「已保存」；点遮罩取消） */}
      {preview && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid={`${app}-sticker-search-preview`}
          onClick={() => setPreview(null)}
        >
          <div
            className="w-[220px] overflow-hidden rounded-[16px] bg-white shadow-2xl dark:bg-[#2A2A2E]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-[150px] items-center justify-center p-3">
              <img src={preview.hit.thumb} alt="表情预览" className="max-h-full max-w-full object-contain" />
            </div>
            <p className="pb-2.5 text-center text-[13px] text-black/45 dark:text-white/45">{preview.meaning || '表情包'}</p>
            <button
              type="button"
              data-testid={`${app}-sticker-search-preview-send`}
              onClick={() => {
                const h = preview.hit;
                setPreview(null);
                pick(h);
              }}
              className="flex h-12 w-full items-center justify-center border-t border-black/[0.06] text-[15px] text-black/85 active:bg-black/[0.04] dark:border-white/[0.08] dark:text-white/90 dark:active:bg-white/[0.06]"
            >
              发送
            </button>
            {previewSaved ? (
              <p
                data-testid={`${app}-sticker-search-preview-saved`}
                className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-black/[0.06] text-[15px] text-black/35 dark:border-white/[0.08] dark:text-white/40"
              >
                <Check className="h-4 w-4" /> 已保存
              </p>
            ) : (
              <button
                type="button"
                data-testid={`${app}-sticker-search-preview-add`}
                onClick={() => addToStickers(preview.hit, preview.index, preview.meaning)}
                className="flex h-12 w-full items-center justify-center border-t border-black/[0.06] text-[15px] text-[#07C160] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
              >
                添加到表情
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
