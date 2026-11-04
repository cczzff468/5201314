'use client';

/**
 * X论坛 · 关注列表页（v44【AI 关注者】）。
 *
 * 个人主页统计行「N 正在关注 / N 关注者」点击进入：
 * - 正在关注（仅自己的主页）：我关注的人（联系人/网友/大V），每行可「取消关注」；
 * - 关注者（自己的主页）：关注了我的 AI 角色名单（charFollowers——角色刷到帖子
 *   或被请求后按人设自主决定关注）+ 帖子热度涨来的可见网友（dynFollowers，v48）；
 *   每行可回关/取消回关；
 * - 他人主页的关注者：谁关注 TA（我若关注了 TA，列表里就有我）；
 *   内置大V 的粉丝基数是平台数据，列表仅展示与我有交互的账号（空态说明）。
 * - 顶栏两 tab 互切（X 官方样式：进「关注者」也能一键切看「正在关注」）。
 */

import { useState, useSyncExternalStore } from 'react';
import {
  charFollowersOf,
  dynFollowersOf,
  followersOf,
  forumData,
  forumSnapshot,
  isUserAuthor,
  resolveAuthor,
  saveForum,
  subscribeForum,
  type AuthorKey,
} from '@/lib/forum/core';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { EmptyState } from './feed';

/** 列表行作者信息（resolveAuthor 结果 + 关注按钮状态由渲染时实时计算） */
export function FollowListView({ authorKey, tab }: { authorKey: AuthorKey; tab: 'following' | 'followers' }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const a = resolveAuthor(authorKey);
  // 大号与匿名小号共用关注列表（X 同设备双号语义，关注是设备行为）
  const isMe = isUserAuthor(authorKey);
  const [cur, setCur] = useState<'following' | 'followers'>(tab);

  /** 「正在关注」名单：仅自己的主页有真实数据（他人不展示其关注列表） */
  const followingKeys = isMe && cur === 'following' ? [...new Set(d.following)] : isMe ? [] : [];
  /** 「关注者」名单：自己 = charFollowers（AI 角色按人设自主关注）+
   *   dynFollowers（帖子热度涨来的可见网友，v48）；
   *  联系人 = 若我关注了 TA 列表里就有我；内置大V = 平台粉丝基数（列表只放真实可交互账号） */
  const followerKeys: AuthorKey[] =
    cur === 'followers'
      ? authorKey === 'user'
        ? [...new Set([...charFollowersOf(), ...dynFollowersOf()])]
        : authorKey.startsWith('char:')
          ? d.following.includes(authorKey)
            ? ['user']
            : []
          : []
      : [];
  const isNpcProfile = authorKey.startsWith('npc:') || authorKey.startsWith('mnpc:');

  /** 取消关注/回关：改的是「我」的关注列表（d.following），与他人无关 */
  const toggleFollowOf = (key: AuthorKey) => {
    const target = resolveAuthor(key);
    const followed = d.following.includes(key);
    const nd = forumData();
    if (followed) nd.following = nd.following.filter((k) => k !== key);
    else nd.following = [...nd.following, key];
    f.toast(followed ? `已取消关注 ${target.name}` : `已关注 ${target.name}，「关注」页将出现 TA 的帖子`);
    saveForum({ ...nd });
  };

  const rows = cur === 'following' ? followingKeys : followerKeys;
  const title = cur === 'following' ? '正在关注' : '关注者';

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏：返回 + 标题 + 名字副标题（X 官方样式） */}
      <div
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{
          borderColor: t.border,
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3 px-3 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-bold">{title}</span>
            <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
              @{a.handle}
            </span>
          </div>
        </div>
        {/* 两 tab 互切（X 官方：关注页内可切 正在关注/关注者；蓝下划线） */}
        <div className="flex items-stretch">
          {(['following', 'followers'] as const).map((k) => {
            const label = k === 'following' ? '正在关注' : '关注者';
            const active = cur === k;
            const disabled = k === 'following' && !isMe;
            return (
              <button
                key={k}
                type="button"
                onClick={() => (disabled ? f.toast('他人的关注列表仅 TA 本人可见') : setCur(k))}
                aria-current={active ? 'page' : undefined}
                className="relative flex h-[44px] flex-1 items-center justify-center text-[15px]"
                style={{ color: active ? t.text : t.secondary, fontWeight: active ? 800 : 500, opacity: disabled ? 0.5 : 1 }}
              >
                {label}
                {active && (
                  <span
                    className="absolute bottom-0 left-1/2 h-[4px] w-14 -translate-x-1/2 rounded-full"
                    style={{ background: t.blue }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 列表（X 官方行样式：头像 + 名字/账号 + 简介 + 关注按钮） */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {cur === 'following' && !isMe ? (
          <EmptyState text="TA 关注了谁仅 TA 本人可见" />
        ) : isNpcProfile && cur === 'followers' ? (
          <EmptyState text="TA 的粉丝太多啦，列表只展示与你有互动的账号" />
        ) : rows.length ? (
          rows.map((key) => {
            const ra = resolveAuthor(key);
            const followedByMe = d.following.includes(key);
            const isRowMe = isUserAuthor(key);
            return (
              <div
                key={key}
                className="flex items-center gap-3 border-b px-4 py-3"
                style={{ borderColor: t.border }}
              >
                <button
                  type="button"
                  onClick={() => f.openProfile(key)}
                  aria-label={`查看 ${ra.name} 的主页`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-60"
                >
                  <XAvatar authorKey={key} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[15px] font-bold">{ra.name}</span>
                      {ra.verified && <VerifiedBadge size={14} />}
                    </span>
                    <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                      @{ra.handle}
                    </span>
                    {ra.bio && (
                      <span className="mt-[2px] block truncate text-[14px]" style={{ color: t.text }}>
                        {ra.bio}
                      </span>
                    )}
                  </span>
                </button>
                {!isRowMe && (
                  <button
                    type="button"
                    aria-label={followedByMe ? `取消关注 ${ra.name}` : `关注 ${ra.name}`}
                    onClick={() => toggleFollowOf(key)}
                    className="flex h-[32px] shrink-0 items-center rounded-full px-4 text-[13px] font-bold transition-opacity active:opacity-60"
                    style={
                      followedByMe
                        ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
                        : { background: t.text, color: t.bg, border: 'none' }
                    }
                  >
                    {followedByMe ? '已关注' : '关注'}
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <EmptyState
            text={
              cur === 'following'
                ? '还没有关注任何人，逛逛广场点「关注」试试'
                : isMe
                  ? '还没有人关注你——发帖、在论坛私信里聊天，AI 好友会按 TA 们的心情决定要不要关注你'
                  : '还没有人关注 TA'
            }
          />
        )}
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          {cur === 'followers' && authorKey === 'user'
            ? `${followersOf('user').toLocaleString()} 人关注了你`
            : rows.length
              ? '已经到底啦'
              : ''}
        </p>
      </div>
    </div>
  );
}
