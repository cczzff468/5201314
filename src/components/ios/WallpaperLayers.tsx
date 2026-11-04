'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** 模块级缓存：壁纸 URL → 自然宽高比（同一 URL 只解码一次图片） */
const ratioCache = new Map<string, number>();
/** LRU 上限（#59）：同一会话内壁纸切换/自定义上传产生大量 URL，无上限会持续增长。16 条够典型多档壁纸往返 */
const RATIO_CACHE_MAX = 16;

/** LRU 读写：写入时若超限删最旧；命中时把 key 移到末尾（Map 保持插入序，重插即升序）。 */
function ratioCacheGet(url: string): number | undefined {
  const v = ratioCache.get(url);
  if (v !== undefined) {
    // 命中后重插使其成为最新（Map 的迭代序保留插入顺序，delete + set 即可移到末尾）
    ratioCache.delete(url);
    ratioCache.set(url, v);
  }
  return v;
}
function ratioCacheSet(url: string, ratio: number): void {
  if (ratioCache.has(url)) ratioCache.delete(url);
  ratioCache.set(url, ratio);
  while (ratioCache.size > RATIO_CACHE_MAX) {
    const oldest = ratioCache.keys().next().value;
    if (oldest === undefined) break;
    ratioCache.delete(oldest);
  }
}

/** 超采样量（px）：全部图层画在比壳大 4px 的盒内再被壳层 overflow-hidden 裁掉，四边绝不露底色细缝 */
const OVER = 2;

/**
 * 自定义壁纸绘制（主屏 PhoneShell 与锁屏 LockScreen 共用）：
 *  - 兜底层：拉伸原图 + 不透明底色铺满全壳——比例未知时的唯一可见层，并保证壳内任何时刻绝不露黑（D4 结论）；
 *  - 比例已知后：中央 contain 完整前景（不裁切）+ 四周「边缘色延伸带」——
 *    取原图最外一行/列像素沿垂直方向拉伸铺满整条延伸带（backgroundSize 千倍放大、贴边定位），
 *    无任何 blur 滤镜；接缝处延伸带颜色 = 前景边缘像素颜色，逐像素同色连续，
 *    肉眼几乎看不出「垫了东西」（用户要求：不要模糊延伸、也不要能看出接缝/分割线）。
 *  - 几何：contain 前景矩形由实测壳尺寸 × 图片宽高比算出（ResizeObserver + Image.naturalSize），
 *    延伸带只在缺带的一侧有实际宽度（另一侧自动为 0、整条藏在前景下面），无需判断方向；
 *    每条延伸带向前景下方多压 2px（画在前景之下），杜绝亚像素接缝。
 */
export function CustomWallpaperLayers({ url }: { url: string }) {
  // ratio 状态带 url 标记：url 变化时在渲染期直接换档（React 官方推荐的 props 派生状态模式，
  // 避免 effect 内同步 setState 触发级联渲染；缓存命中时首次渲染即拿到比例，零闪烁）
  const [ratioState, setRatioState] = useState<{ url: string; ratio: number | null }>(() => ({
    url,
    ratio: ratioCacheGet(url) ?? null,
  }));
  if (ratioState.url !== url) {
    setRatioState({ url, ratio: ratioCacheGet(url) ?? null });
  }
  const ratio = ratioState.url === url ? ratioState.ratio : (ratioCacheGet(url) ?? null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  // 缓存未命中时异步解码读宽高比（结果模块级缓存，同一 URL 只解码一次）
  useLayoutEffect(() => {
    if (ratioCache.has(url)) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive || !img.naturalWidth || !img.naturalHeight) return;
      const r = img.naturalWidth / img.naturalHeight;
      ratioCacheSet(url, r);
      setRatioState({ url, ratio: r });
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);

  // 实测壳内尺寸（旋转/分屏/桌面改窗时跟随）
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let layers: ReactNode = null;
  if (ratio && box && box.w > 0 && box.h > 0) {
    const W = box.w + OVER * 2;
    const H = box.h + OVER * 2;
    const fgW = Math.min(W, H * ratio);
    const fgH = Math.min(H, W / ratio);
    const sideW = (W - fgW) / 2;
    const topH = (H - fgH) / 2;
    const bg = `url(${url})`;
    // 边缘带背景：千倍放大后只露出最外一行/列（对 800px 高的图 ≈ 最外 0.8 行）
    const vBandSize = `100% ${Math.round(H * 1000)}px`;
    const hBandSize = `${Math.round(W * 1000)}px 100%`;
    const band = (style: CSSProperties, key: string) => (
      <div key={key} aria-hidden="true" className="absolute" style={style} />
    );
    layers = (
      <>
        {/* 上延伸带：原图最外一行向下拉伸（多压 2px 到前景下面） */}
        {band(
          {
            left: -OVER,
            top: -OVER,
            width: W,
            height: topH + OVER,
            backgroundImage: bg,
            backgroundSize: vBandSize,
            backgroundPosition: 'center top',
            backgroundRepeat: 'no-repeat',
          },
          'wt',
        )}
        {/* 下延伸带：原图最外一行向上拉伸 */}
        {band(
          {
            left: -OVER,
            bottom: -OVER,
            width: W,
            height: topH + OVER,
            backgroundImage: bg,
            backgroundSize: vBandSize,
            backgroundPosition: 'center bottom',
            backgroundRepeat: 'no-repeat',
          },
          'wb',
        )}
        {/* 左延伸带：原图最外一列向右拉伸（比例匹配时宽度为 0+2px，整条藏在前景下） */}
        {band(
          {
            left: -OVER,
            top: -OVER,
            width: sideW + OVER,
            height: H,
            backgroundImage: bg,
            backgroundSize: hBandSize,
            backgroundPosition: 'left center',
            backgroundRepeat: 'no-repeat',
          },
          'wl',
        )}
        {/* 右延伸带：原图最外一列向左拉伸 */}
        {band(
          {
            right: -OVER,
            top: -OVER,
            width: sideW + OVER,
            height: H,
            backgroundImage: bg,
            backgroundSize: hBandSize,
            backgroundPosition: 'right center',
            backgroundRepeat: 'no-repeat',
          },
          'wr',
        )}
        {/* contain 前景：完整显示原图不裁切（比例与壳一致时铺满全壳，与 cover 视觉一致） */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            left: -OVER + sideW,
            top: -OVER + topH,
            width: fgW,
            height: fgH,
            backgroundImage: bg,
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      </>
    );
  }

  return (
    <>
      {/* 兜底层：拉伸铺满 + 不透明底色（兼作测量元素） */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: '#1c1c1e',
          backgroundImage: `url(${url})`,
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {layers}
    </>
  );
}
