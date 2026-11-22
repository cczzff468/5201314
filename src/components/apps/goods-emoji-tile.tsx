'use client';

/**
 * Emoji 样式商品图（第六十四轮）：不加载图片，按品类渲染「马卡龙渐变底 + 大 emoji」，
 * 保留图内底部名字条（订单/商品叫什么就显示什么）。淘宝 TbImg / 美团 FoodImg 共用。
 * 字号固定 34px（与图挂 emoji 兜底同款体验，小缩略图/中大图位都协调）。
 */
import { emojiPaletteOf } from '@/lib/ios/goods-emoji';

export function EmojiTile({
  emoji,
  cap,
  className = '',
}: {
  emoji: string;
  /** 图内底部名字条（白字渐变贴片，与真实图样式同款） */
  cap?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative block overflow-hidden bg-gradient-to-br ${emojiPaletteOf(emoji)} ${className}`}
      data-testid="goods-emoji-tile"
    >
      {/* 大 emoji 居中 + 左上柔光（让色块更像「图」而不是纯色） */}
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span className="text-[34px] leading-none drop-shadow-sm">{emoji}</span>
      </span>
      <span className="absolute inset-0 bg-gradient-to-br from-white/45 via-transparent to-black/[0.04]" aria-hidden="true" />
      {cap ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/25 to-transparent px-1.5 pb-[3px] pt-5">
          <span className="block truncate text-center text-[9px] font-medium leading-tight text-white drop-shadow-sm">{cap}</span>
        </span>
      ) : null}
    </span>
  );
}
