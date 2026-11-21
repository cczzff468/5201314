'use client';

/**
 * 微信照片堆叠卡片 + 多图大图查看器（微信单聊 / 群聊共用）：
 *
 * 一、照片堆叠卡 WxPhotoStack（连续照片 >3 张时的折叠形态，对照原生微信）：
 *   - 「展开 N」胶囊在左侧垂直居中，点击后由调用方取消折叠（恢复逐条平铺，展开后不收回，同原生）；
 *   - 右侧扇形露出后面 2 张照片的边缘（后一张依次右移/下移，做出卡片堆叠层次）；
 *   - 在堆叠上水平左滑 → 主图切到下一张（到末张停住）；右滑 → 上一张；点击主图 → 大图查看器（onOpenAt）；
 *   - 拖动时主图跟手位移（0.35 倍），松开吸附回位；切图带轻微滑入动画。
 *
 * 二、多图大图查看器 WxPhotoViewer（替代旧的单图 Lightbox，微信单聊/群聊共用）：
 *   - 全屏黑底 + 图片居中 object-contain + 底部「i / N」索引指示 + 右上角关闭按钮；
 *   - 水平左滑 → 下一张、右滑 → 上一张（跟手拖动、松开按位移阈值翻页或回弹，首末张有阻尼）；
 *   - 点击任意处关闭；支持键盘 ←/→ 翻页、Esc 关闭（无障碍/桌面端）；
 *   - 单图（N=1）时无指示器、滑动即关闭，兼容表情包大图等单图入口。
 *
 * 三、分组 findPhotoStackSpans：在消息列表里找「连续可堆叠照片」区段——相邻且 joined(a,a+1)
 *   成立才延续（调用方用「同一发送者 + 间隔 ≤5 分钟」实现 joined，与时间分隔行同口径），
 *   区段长度 >3（即至少 4 张）才成堆；返回 [起,止] 闭区间下标数组。
 */

import { useRef, useState } from 'react';

export interface PhotoStackItem {
  /** 消息 id（React key / 展开状态标记用） */
  id: string;
  /** 图片 dataURL */
  src: string;
}

/** 在 count 条消息里找「连续照片」区段：isPhoto(i) 判断第 i 条是否照片；joined(a,b) 判断相邻两条是否同堆 */
export function findPhotoStackSpans(
  count: number,
  isPhoto: (i: number) => boolean,
  joined: (a: number, b: number) => boolean,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < count) {
    if (!isPhoto(i)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < count && isPhoto(j + 1) && joined(j, j + 1)) j += 1;
    // 超过 3 张才折叠（4 张起）；≤3 张保持逐条平铺
    if (j - i + 1 > 3) spans.push([i, j]);
    i = j + 1;
  }
  return spans;
}

/** 照片堆叠卡（折叠态渲染；items 顺序 = 消息时间顺序，主图初始为第 1 张） */
export function WxPhotoStack({
  items,
  onOpenAt,
  onExpand,
}: {
  items: PhotoStackItem[];
  /** 点击主图 → 打开大图查看器（从当前主图下标开始） */
  onOpenAt: (index: number) => void;
  /** 点「展开 N」→ 调用方取消该组折叠（恢复逐条平铺） */
  onExpand: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState<{ dx: number; active: boolean } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const last = items.length - 1;

  const goNext = () => setIdx((v) => Math.min(last, v + 1));
  const goPrev = () => setIdx((v) => Math.max(0, v - 1));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, active: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 指针捕获失败不影响后续手势判定
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    setDrag({ dx: e.clientX - startRef.current.x, active: true });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    startRef.current = null;
    setDrag(null);
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // 视为点击 → 大图查看器（从当前主图开始，大图内同样可左滑切换）
      onOpenAt(idx);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 36) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  /** 主图后面的卡片：当前主图的下一张、下两张（有则露出边缘） */
  const behind = [items[idx + 1], items[idx + 2]].filter((x): x is PhotoStackItem => Boolean(x));
  /** 拖动跟手位移（0.35 倍，±34px 封顶），松开回 0 */
  const dragDx = drag?.active ? Math.max(-34, Math.min(34, drag.dx * 0.35)) : 0;

  return (
    <div
      className="flex items-center gap-2.5"
      data-testid="wx-photo-stack"
      data-stack-index={idx}
      data-stack-count={items.length}
    >
      {/* 展开 N（左侧垂直居中，微信同款半透明胶囊；点击取消折叠恢复平铺） */}
      <button
        type="button"
        data-testid="wx-photo-stack-expand"
        aria-label={`展开全部 ${items.length} 张照片`}
        onClick={onExpand}
        className="shrink-0 rounded-full bg-black/[0.055] px-3 py-[7px] text-[13.5px] leading-none text-black/55 backdrop-blur-sm transition-opacity active:opacity-60 dark:bg-white/[0.12] dark:text-white/65"
      >
        展开 {items.length}
      </button>
      {/* 堆叠容器：右侧预留露边空间（后两张各右移 9/18px） */}
      <div className="relative my-[6px] mr-[22px]">
        <div
          role="button"
          tabIndex={0}
          aria-label={`照片堆叠，共 ${items.length} 张，当前第 ${idx + 1} 张，左右滑动切换，点击查看大图`}
          data-testid="wx-photo-stack-card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            startRef.current = null;
            setDrag(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              goNext();
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              goPrev();
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenAt(idx);
            }
          }}
          className="relative touch-pan-y select-none outline-none"
          style={{
            transform: dragDx ? `translateX(${dragDx}px)` : undefined,
            transition: drag?.active ? 'none' : 'transform 0.22s ease',
          }}
        >
          {/* 后面露边的卡片（次序靠后的 z 更低、偏移更大） */}
          {behind.map((p, k) => (
            <img
              key={p.id}
              src={p.src}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="absolute inset-0 h-full w-full rounded-[12px] object-cover shadow-[0_2px_10px_rgba(0,0,0,0.16)]"
              style={{ zIndex: 2 - k, transform: `translate(${(k + 1) * 9}px, ${(k + 1) * 6}px)` }}
            />
          ))}
          {/* 主图（key 随切换变化 → 重放轻微滑入动画） */}
          <style>{`@keyframes wxstack-in{from{opacity:.35;transform:translateX(14px)}to{opacity:1;transform:none}}`}</style>
          <img
            key={items[idx].id}
            src={items[idx].src}
            alt={`照片 ${idx + 1}/${items.length}`}
            draggable={false}
            className="relative z-[3] block max-h-[240px] w-auto min-w-[130px] max-w-[186px] rounded-[12px] object-cover shadow-[0_2px_10px_rgba(0,0,0,0.16)]"
            style={{ animation: idx > 0 ? 'wxstack-in 0.18s ease-out' : undefined }}
          />
        </div>
      </div>
    </div>
  );
}

/** 多图大图查看器（全屏遮罩；urls 全部图片、index 当前下标；翻页/关闭经回调同步给调用方） */
export function WxPhotoViewer({
  urls,
  index,
  onClose,
  onIndexChange,
  testId = 'wx-img-view',
}: {
  urls: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** 遮罩 data-testid（群聊用 wx-group-img-view 区分） */
  testId?: string;
}) {
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const last = urls.length - 1;

  /** 翻页（带吸附过渡）：越界钳制 */
  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(last, i));
    setAnim(true);
    setDx(0);
    if (next !== index) onIndexChange(next);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    setAnim(false);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 指针捕获失败不影响后续手势判定
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s) return;
    setDx(e.clientX - s.x);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    startRef.current = null;
    setAnim(true);
    if (!s) {
      setDx(0);
      return;
    }
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // 点击任意处关闭
      setDx(0);
      onClose();
      return;
    }
    if (dx < -60) goTo(index + 1);
    else if (dx > 60) goTo(index - 1);
    else setDx(0); // 位移不够 → 回弹
  };

  /** 拖动跟手位移；首张右滑/末张左滑给 0.3 倍阻尼（提示到头了） */
  const rawDx = dx;
  const damped =
    (index === 0 && rawDx > 0) || (index === last && rawDx < 0) ? rawDx * 0.3 : rawDx;

  return (
    <div
      className="absolute inset-0 z-50 select-none overflow-hidden bg-black outline-none"
      data-testid={testId}
      data-view-index={index}
      data-view-count={urls.length}
      tabIndex={0}
      role="dialog"
      aria-label={`图片预览 ${index + 1}/${urls.length}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          goTo(index + 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goTo(index - 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* 图片层（水平跟手拖动） */}
      <div
        className="flex h-full w-full touch-none items-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startRef.current = null;
          setAnim(true);
          setDx(0);
        }}
        style={{
          transform: damped ? `translateX(${damped}px)` : undefined,
          transition: anim ? 'transform 0.22s ease' : 'none',
        }}
      >
        <img
          src={urls[index]}
          alt={`图片预览 ${index + 1}/${urls.length}`}
          draggable={false}
          className="mx-auto max-h-full max-w-full object-contain"
        />
      </div>
      {/* 底部索引指示（单图不显示） */}
      {urls.length > 1 && (
        <div
          data-testid="wx-img-view-indicator"
          className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[13px] leading-none tabular-nums text-white/90"
        >
          {index + 1} / {urls.length}
        </div>
      )}
      {/* 右上角关闭（保留旧版 Lightbox 的位置与样式） */}
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
        className="absolute right-4 top-[64px] z-[1] text-white/85 active:opacity-60"
      >
        <XGlyph />
      </button>
    </div>
  );
}

/** 关闭图标（内联 SVG，避免各聊天文件重复 import lucide） */
function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-7 w-7">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
