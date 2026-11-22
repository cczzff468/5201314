'use client';

/**
 * X论坛帖子分享卡（微信/QQ 聊天气泡；用户分享给 AI 与 AI 分享给机主共用）：
 *
 * - 动态卡：渲染时实时读论坛 store（正文/点赞/评论数跟帖走，删帖自动失效）；
 * - 双向：side='right'（我发出的）箭头指右，side='left'（AI 发来的）箭头指左；
 * - 点击卡片 → navigateToForumPost 深链跳论坛 App 打开对应帖子页；
 * - 白底卡片 + 𝕏 品牌位 + 作者（XAvatar）+ 正文三行摘要 + 互动数，样式对齐
 *   淘宝/美团分享卡（252px 宽、圆角 14、箭头小方块）。
 */

import { useSyncExternalStore } from 'react';
import { ChevronRight, Heart, MessageCircle, Repeat2 } from 'lucide-react';
import { communityName, forumSnapshot, likesOf, resolveAuthor, subscribeForum } from '@/lib/forum/core';
import { IMG_PLACEHOLDER } from '@/lib/forum/imgph';
import { navigateToForumPost } from '@/lib/ios/forum-share';
import { XAvatar, XLogo } from './shared';

export function ForumShareBubble({ pid, side = 'right' }: { pid: string; side?: 'left' | 'right' }) {
  // 论坛 store 订阅：帖子数据变化（点赞/新评论/删除）实时刷新卡片
  const snap = useSyncExternalStore(subscribeForum, forumSnapshot);
  const post = snap.data.posts.find((p) => p.id === pid) ?? null;
  const author = post ? resolveAuthor(post.authorKey) : null;

  if (!post || !author) {
    return (
      <div className="relative w-[252px] rounded-[14px] bg-white p-3 shadow-[0_5px_16px_rgba(0,0,0,0.10)]">
        <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />
        <div className="flex items-center gap-1.5">
          <span className="grid h-[20px] w-[20px] place-items-center rounded-[5px] bg-black/[0.85] text-white">
            <XLogo size={12} />
          </span>
          <span className="text-[12px] font-semibold text-black/45">X论坛</span>
        </div>
        <p className="mt-1.5 text-[12px] text-black/35">帖子已被删除或不存在</p>
      </div>
    );
  }

  const commentCount = snap.data.posts.filter((p) => p.replyTo === post.id).length;
  const bodyText = post.content
    .split(IMG_PLACEHOLDER)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');

  return (
    <div
      data-testid="forum-share-bubble"
      role="button"
      aria-label={`X论坛帖子分享：${author.name}的帖子，点击查看详情`}
      onClick={() => navigateToForumPost(post.id)}
      className="chat-card chat-card-forumshare chat-card-body relative block w-[252px] cursor-pointer rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-transform duration-150 active:scale-[0.97]"
    >
      {/* 箭头指向头像侧（我发出 → 右；AI 发来 → 左） */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />

      {/* 头部：𝕏 品牌位 + X论坛 */}
      <span className="relative flex items-center gap-1.5">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-black text-white">
          <XLogo size={13} />
        </span>
        <span className="text-[13px] font-semibold text-black/85">X论坛</span>
        <span className="ml-auto text-[10.5px] font-medium text-black/35">帖子分享</span>
      </span>

      {/* 作者行：头像 + 名字 + @账号 */}
      <span className="relative mt-2 flex items-center gap-2">
        <XAvatar authorKey={post.authorKey} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold leading-tight text-black/90">{author.name}</span>
          <span className="block truncate text-[10.5px] leading-tight text-black/40">@{author.handle}</span>
        </span>
      </span>

      {/* 正文摘要（三行截断；带图帖附 N 图徽标） */}
      <p className="relative mt-1.5 line-clamp-3 text-[12.5px] leading-[1.55] text-black/75">
        {bodyText || '（无文字内容）'}
        {post.media?.length ? <span className="ml-1 shrink-0 text-[10.5px] text-black/35">· {post.media.length}图</span> : null}
      </p>

      {/* 互动数行 */}
      <span className="relative mt-1.5 flex items-center gap-3 text-[10.5px] text-black/40">
        <span className="flex items-center gap-[3px]" aria-hidden="true">
          <Heart className="h-[11px] w-[11px]" strokeWidth={2.2} />
          {likesOf(post)}
        </span>
        <span className="flex items-center gap-[3px]" aria-hidden="true">
          <Repeat2 className="h-[11px] w-[11px]" strokeWidth={2.2} />
          {post.reposts}
        </span>
        <span className="flex items-center gap-[3px]" aria-hidden="true">
          <MessageCircle className="h-[11px] w-[11px]" strokeWidth={2.2} />
          {commentCount}
        </span>
      </span>

      {/* 底注：来源 + 查看详情提示（整卡可点） */}
      <span className="relative mt-2 flex items-center justify-between border-t border-black/[0.05] pt-1.5 text-[10px] text-black/30">
        <span className="truncate">X论坛 · {post.community ? communityName(post.community) : '今日热议'}</span>
        <span className="flex shrink-0 items-center gap-0.5 font-medium text-[#1d9bf0]">
          查看帖子
          <ChevronRight className="h-3 w-3" strokeWidth={2.4} />
        </span>
      </span>
    </div>
  );
}
