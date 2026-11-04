'use client';

/**
 * 淘宝内容匹配图组件：taobao.tsx / taobao-channels.tsx 全站共用。
 *
 * 图源为本地 kawaii 卡通插画（Task 59 落盘）：src 由 taobao-data.tbImg 产出
 * /goods/*.webp 本地图（原真实图库直链 /api/tb-img 链路已删除）；用户上传 dataURL
 * 等自定义图原样显示。本地图全链有图，前端仅做一次重试，再失败显示 emoji 兜底/占位；
 * 加载期 shimmer，弱网不再是大灰块。
 *
 * 商品图样式（第六十四轮，设置›主题›商品图片样式，全局三选一）：
 * - cartoon：/goods/*.webp 卡通插画（默认，旧版行为不变）
 * - sketch：/goods-sketch/*.webp 黑白简笔画线稿（同名文件，只换目录前缀）
 * - emoji：不加载图，按品类渲染马卡龙底 + 大 emoji（保留 cap 名字条）
 * 用户自定义图（http/dataURL）三种样式下都原样显示。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { legacyImgUrl } from '@/lib/ios/goods-img';
import { goodsEmojiOf, SKETCH_IMG_PREFIX } from '@/lib/ios/goods-emoji';
import { useSettings } from '@/lib/ios/store';
import { EmojiTile } from './goods-emoji-tile';

/** 按图源文件名推断品类 emoji（映射表共享在 lib/ios/goods-emoji.ts，emoji 样式/图挂兜底同源） */
function fallbackEmojiOf(src: string | undefined): string | undefined {
  const m = src?.match(/\/goods(?:-sketch)?\/[a-z0-9-]+\.webp/i);
  if (!m) return undefined;
  return goodsEmojiOf(m[0]);
}

export function TbImg({
  src,
  emoji,
  cap,
  className = '',
  alt = '',
}: {
  src?: string;
  emoji?: string;
  /** 图内底部名字条（订单名/商品名，白字渐变贴片） */
  cap?: string;
  className?: string;
  alt?: string;
}) {
  const style = useSettings((s) => s.goodsImgStyle);
  const local = legacyImgUrl(src, 'tb');
  // emoji 样式：本地 /goods/ 图 → 马卡龙 emoji 块（外链/dataURL 自定义图原样走图片链路）
  if (style === 'emoji' && local && local.startsWith('/goods/')) {
    const e = emoji ?? goodsEmojiOf(local) ?? '🛍️';
    return <EmojiTile emoji={e} cap={cap} className={className} />;
  }
  // sketch 样式：本地 /goods/ → /goods-sketch/ 同名线稿（外链/dataURL 原样）
  const finalSrc =
    style === 'sketch' && local && local.startsWith('/goods/')
      ? `${SKETCH_IMG_PREFIX}${local.slice('/goods/'.length)}`
      : local;
  return (
    <TbImgInner
      key={finalSrc ?? 'none'}
      src={finalSrc}
      emoji={emoji}
      cap={cap}
      className={className}
      alt={alt}
    />
  );
}

function TbImgInner({
  src,
  emoji,
  cap,
  className = '',
  alt = '',
}: {
  src?: string;
  emoji?: string;
  cap?: string;
  className?: string;
  alt?: string;
}) {
  // stage：0=主源首载 1=主源重试（延迟+cache-buster） 2=占位（本地静态图，占位仅极端故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // 重试时追加 r= 查询参数绕过可能的负缓存/半程响应（Task 60：修复偶发单图 404 后同 URL 重试仍 404）
  const cur = stage === 0 ? src : stage === 1 ? `${src}${src?.includes('?') ? '&' : '?'}r=1` : undefined;
  // 未显式传 emoji 时按图源文件名推断兜底 emoji（与美团 FoodImg 同款暖色渐变兜底）
  const fb = emoji ?? fallbackEmojiOf(cur) ?? fallbackEmojiOf(src);
  if (!cur) {
    // 无图 + 有 emoji：暖色渐变 + emoji 大字兜底，不再是「加载失败」灰块
    if (fb) {
      return (
        <div
          className={`flex items-center justify-center bg-gradient-to-br from-[#FFE9B8] via-[#FFDF9E] to-[#FFD100]/70 ${className}`}
          aria-hidden="true"
        >
          <span className="text-[34px] leading-none drop-shadow-sm">{fb}</span>
        </div>
      );
    }
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-[#EBEDF0] ${className}`} aria-hidden="true">
        <ImageOff className="h-[30%] w-[30%] text-black/25" strokeWidth={1.8} />
        <span className="text-[10px] leading-none text-black/30">图片加载失败</span>
      </div>
    );
  }
  return (
    <span className={`relative block overflow-hidden bg-[#F5F6F7] ${className}`}>
      {/* 加载期 shimmer：弱网/首次解码时不再是大灰块 */}
      {!loaded && <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-black/[0.03] via-black/[0.07] to-black/[0.03]" aria-hidden="true" />}
      <img
        key={`${stage}-${cur}`}
        src={cur}
        alt={alt}
        referrerPolicy="no-referrer"
        draggable={false}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (stage === 0) {
            // 首败延迟重试：避开 dev 编译窗口/瞬时抖动（同帧立即重试会二次 404 直接落灰块）
            window.setTimeout(() => setStage(1), 400);
          } else {
            setStage(2); // 1→2 占位
          }
        }}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 图内底部名字条：这个订单/商品叫什么就显示什么（仿电商图的白字贴片） */}
      {cap ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/25 to-transparent px-1.5 pb-[3px] pt-5" aria-hidden="true">
          <span className="block truncate text-center text-[9px] font-medium leading-tight text-white drop-shadow-sm">{cap}</span>
        </span>
      ) : null}
    </span>
  );
}
