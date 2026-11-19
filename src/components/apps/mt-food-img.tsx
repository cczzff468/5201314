'use client';

/**
 * 美团内容匹配图组件（共享版）：meituan.tsx 与 meituan-shangou.tsx 等多页共用。
 *
 * 图源为预生成本地 kawaii 卡通插画（Task 58）：src 由 meituan-data.mtImg 产出
 * /goods/*.webp 本地图（原外部图库抓取链路已删除）；用户上传 dataURL 等自定义图原样显示。
 * 本地图全链有图，前端仅做一次重试，再失败显示 emoji 暖色渐变兜底 / 灰色占位；
 * 加载期 shimmer，弱网不再是大灰块。
 *
 * 商品图样式（第六十四轮，设置›主题›商品图片样式，全局三选一）：
 * - cartoon：/goods/*.webp 卡通插画（默认，旧版行为不变）
 * - sketch：/goods-sketch/*.webp 黑白简笔画线稿（同名文件，只换目录前缀）
 * - emoji：不加载图，按品类（传入 emoji 或按文件名推断）渲染马卡龙底 + 大 emoji
 * 用户自定义图（http/dataURL）三种样式下都原样显示。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { legacyImgUrl } from '@/lib/ios/goods-img';
import { goodsEmojiOf, SKETCH_IMG_PREFIX } from '@/lib/ios/goods-emoji';
import { useSettings } from '@/lib/ios/store';
import { EmojiTile } from './goods-emoji-tile';

export function FoodImg({ src, emoji, cap, className = '' }: { src?: string; emoji?: string; /** 图内底部名字条（订单名/菜名，白字渐变贴片） */ cap?: string; className?: string }) {
  const style = useSettings((s) => s.goodsImgStyle);
  const local = legacyImgUrl(src, 'mt');
  // emoji 样式：本地 /goods/ 图 → 马卡龙 emoji 块（传入 emoji 优先，再按文件名推断；自定义外链原样走图片链路）
  if (style === 'emoji' && local && local.startsWith('/goods/')) {
    const e = emoji ?? goodsEmojiOf(local) ?? '🍽️';
    return <EmojiTile emoji={e} cap={cap} className={className} />;
  }
  // sketch 样式：本地 /goods/ → /goods-sketch/ 同名线稿（外链/dataURL 原样）
  const finalSrc =
    style === 'sketch' && local && local.startsWith('/goods/')
      ? `${SKETCH_IMG_PREFIX}${local.slice('/goods/'.length)}`
      : local;
  return <FoodImgInner key={finalSrc ?? 'none'} src={finalSrc} emoji={emoji} cap={cap} className={className} />;
}

function FoodImgInner({ src, emoji, cap, className = '' }: { src?: string; emoji?: string; cap?: string; className?: string }) {
  // stage：0=主源首载 1=主源重试 2=占位（本地静态图，占位仅极端故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cur = stage <= 1 ? src : undefined;
  if (!cur) {
    // 无图 + 有 emoji（商家入驻未上传图）：暖黄渐变 + emoji 大字兜底，不再是「加载失败」灰块
    if (emoji) {
      return (
        <div
          className={`flex items-center justify-center bg-gradient-to-br from-[#FFE9B8] via-[#FFDF9E] to-[#FFD100]/70 ${className}`}
          aria-hidden="true"
        >
          <span className="text-[34px] leading-none drop-shadow-sm">{emoji}</span>
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
        alt=""
        draggable={false}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setStage((s) => Math.min(2, s + 1));
        }}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 图内底部名字条：这个订单/菜品叫什么就显示什么（仿真实外卖菜品图的白字贴片） */}
      {cap ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/25 to-transparent px-1.5 pb-[3px] pt-5" aria-hidden="true">
          <span className="block truncate text-center text-[9px] font-medium leading-tight text-white drop-shadow-sm">{cap}</span>
        </span>
      ) : null}
    </span>
  );
}
