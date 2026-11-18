'use client';

/**
 * 歌曲封面 img（空 src 安全）——供主屏小组件（音乐/黑胶/灵动岛/全局迷你条）使用。
 *
 * 修复：「空字符串传给 img src 导致浏览器整页重新下载」告警 ——
 * 无封面（QQ/酷狗部分歌曲无 picUrl）时渲染占位（唱片图标），不再渲染 <img src="">；
 * http 封面走同源流代理（规避 https 预览环境混合内容拦截）。
 */

import { useState } from 'react';
import { Disc3 } from 'lucide-react';
import { songCover, type NcmSong } from '@/lib/ios/music-api';
import { mediaProxyUrl } from '@/lib/ios/music-store';

export function SongCoverImg({
  song,
  className = '',
  rounded = '',
  alt = '',
  iconClassName = '',
  style,
}: {
  song: NcmSong | null | undefined;
  className?: string;
  /** 占位圆角（如 rounded-full） */
  rounded?: string;
  alt?: string;
  iconClassName?: string;
  style?: React.CSSProperties;
}) {
  const raw = song ? songCover(song) : '';
  const url = raw ? (raw.startsWith('http://') ? mediaProxyUrl(raw) : raw) : '';
  // 失败态与 url 绑定：换歌后重新尝试加载
  const [state, setState] = useState({ url, failed: false });
  if (state.url !== url) setState({ url, failed: false });
  const failed = state.url === url && state.failed;
  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        style={style}
        className={`flex items-center justify-center bg-black/[0.06] dark:bg-white/10 ${rounded} ${className}`}
      >
        <Disc3 className={`text-black/25 dark:text-white/30 ${iconClassName || 'h-1/2 w-1/2'}`} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      className={rounded ? `${rounded} ${className}` : className}
      style={style}
      onError={() => setState({ url, failed: true })}
    />
  );
}
