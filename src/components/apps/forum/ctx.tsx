'use client';

/** X论坛 · UI 上下文（主框架提供；各页面/卡片消费）。 */

import { createContext, useContext } from 'react';
import { type AuthorKey, type ForumPost } from '@/lib/forum/core';
import type { XTheme } from './shared';

export type ViewSpec =
  | { kind: 'thread'; postId: string }
  | { kind: 'profile'; key: AuthorKey }
  | { kind: 'community'; id: string }
  | { kind: 'dm'; peerKey: AuthorKey }
  | { kind: 'followList'; key: AuthorKey; tab: 'following' | 'followers' };

/** 发布界面提交的扩展内容（媒体/投票/位置/定时） */
export interface ComposeExtras {
  media?: string[];
  poll?: { options: string[] };
  location?: string;
  visibleAt?: number;
}

export interface ForumUi {
  t: XTheme;
  push: (v: ViewSpec) => void;
  pop: () => void;
  /** 替换栈顶视图（不叠加返回层级）——账号切换用：大号主页 ↔ 匿名主页
   *  互切后点一次返回直接回主界面，不再退两层。 */
  replace: (v: ViewSpec) => void;
  openThread: (postId: string) => void;
  openProfile: (key: AuthorKey) => void;
  openCommunity: (id: string) => void;
  openDm: (peerKey: AuthorKey) => void;
  /** v44【AI 关注者】：打开「正在关注/关注者」列表页（个人主页统计行点击进入） */
  openFollowList: (key: AuthorKey, tab: 'following' | 'followers') => void;
  toast: (text: string) => void;
  likeToggle: (postId: string) => void;
  repostToggle: (postId: string) => void;
  /** 跳去某个主 tab（0..4 = 主页/搜索/社区/通知/私信） */
  gotoTab: (i: number) => void;
  /** 帖子右上「···」→ 底部更多菜单（推荐/不感兴趣/举报） */
  openPostMenu: (post: ForumPost) => void;
  /** 【点击生图】点击帖子里的文字图片卡片 → 打开生成弹层
  *  （提示词预填源文本可改；成功后原位替换成真图） */
  openTextImgGen: (post: ForumPost, mediaIndex: number) => void;
  /** 投票：点选某选项 */
  castVote: (postId: string, optionIndex: number) => void;
  /** 分享图标 → 帖子分享弹层（选微信/QQ → 选联系人 → 帖子卡进聊天 + AI 回应） */
  sharePost: (post: ForumPost) => void;
}

export const ForumCtx = createContext<ForumUi | null>(null);

export function useForum(): ForumUi {
  const v = useContext(ForumCtx);
  if (!v) throw new Error('ForumCtx missing');
  return v;
}
