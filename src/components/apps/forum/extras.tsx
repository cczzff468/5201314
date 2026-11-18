'use client';

/**
 * X论坛 · 搜索 / 社区 / 社区页 / 通知（三个主 tab + 推入页之一）。
 * - SearchView：X 搜索页（搜索胶囊 + 趋势榜 + 实时结果）
 * - CommunitiesView：X 社区页（我的社区 + 推荐版块；加入/进入）
 * - CommunityPage：版块内帖子流（仅主帖，回复不在版块流展示；无横幅背景）
 * - NotificationsView：X 通知页（图标按类型着色；打开页 600ms 后全部标记已读）
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  COMMUNITY_DEFS,
  countShort,
  forumData,
  forumSnapshot,
  isPostVisible,
  activeAuthorKey,
  relTime,
  resolveAuthor,
  saveForum,
  subscribeForum,
  trendingTopics,
  type ForumPost,
} from '@/lib/forum/core';
import { XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';
import { PostCard, EmptyState, CommunityIcon } from './feed';
// v43（C4）：老熟人检测——通知文案「又来了」记忆梗
import { isNpcVeteran } from '@/lib/forum/npc-memory';

/** 通用页面头（X 二级 tab 头：标题 + 可选右侧按钮） */
function PageHead({ title, right }: { title: string; right?: React.ReactNode }) {
  const f = useForum();
  const t = f.t;
  return (
    <div
      className="sticky top-0 z-20 shrink-0 border-b"
      style={{
        borderColor: t.border,
        background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-between px-4 pt-[54px]" style={{ height: 104 }}>
        <h1 className="text-[21px] font-extrabold">{title}</h1>
        {right}
      </div>
    </div>
  );
}

// ---------------- 搜索 ----------------

/** 搜索页二级 tab：为你推荐(最新流) / 热门(趋势榜) / 新闻·体育·娱乐(映射版块帖子流) */
type STab = 'foryou' | 'trending' | 'news' | 'sports' | 'fun';
const STAB_DEFS: { key: STab; label: string; community: string | null }[] = [
  { key: 'foryou', label: '为你推荐', community: '' }, // '' = 全部社区最新主帖
  { key: 'trending', label: '热门', community: null }, // null = 趋势榜
  { key: 'news', label: '新闻', community: 'hot' },
  { key: 'sports', label: '体育', community: 'fit' },
  { key: 'fun', label: '娱乐', community: 'game' },
];

export function SearchView() {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const [q, setQ] = useState('');
  const [sTab, setSTab] = useState<STab>('foryou');
  const trends = useMemo(() => trendingTopics(d), [d]);

  const results = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return [];
    return d.posts
      .filter(
        (p) =>
          isPostVisible(p) &&
          (p.content.toLowerCase().includes(kw) ||
            resolveAuthor(p.authorKey).name.toLowerCase().includes(kw) ||
            resolveAuthor(p.authorKey).handle.toLowerCase().includes(kw)),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [d, q]);

  // 当前 tab 对应的主帖流（热门 tab=趋势榜不用；''=全部社区最新）
  const stabCommunity = STAB_DEFS.find((x) => x.key === sTab)?.community ?? null;
  const tabPosts = useMemo(() => {
    if (stabCommunity === null) return [];
    return d.posts
      .filter((p) => p.replyTo === null && isPostVisible(p))
      .filter((p) => stabCommunity === '' || (p.community ?? 'hot') === stabCommunity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);
  }, [d, stabCommunity]);

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏（X：头像 | 搜索胶囊内嵌输入 | 齿轮）+ 横滑 tab 行 */}
      <div
        className="sticky top-0 z-20 shrink-0"
        style={{
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3 px-4 pt-[54px]" style={{ height: 100 }}>
          <XAvatar authorKey={activeAuthorKey()} size={32} onClick={() => f.openProfile(activeAuthorKey())} />
          <label
            className="flex h-[40px] min-w-0 flex-1 items-center gap-2 rounded-full px-3"
            style={{ background: t.dark ? '#202327' : '#eff3f4' }}
          >
            <span className="shrink-0" style={{ color: t.secondary }}>
              {XIcons.search(18)}
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索X论坛"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              style={{ color: t.text, caretColor: t.blue }}
              aria-label="搜索X论坛"
            />
          </label>
          <button
            type="button"
            aria-label="搜索设置"
            onClick={() => f.toast('搜索范围：全部帖子与作者')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.settings(21)}
          </button>
        </div>
        {/* 横滑 tab 行（X：选中黑粗 + 蓝下划线） */}
        <div className="flex items-center border-b px-4" style={{ borderColor: t.border, height: 44 }}>
          {STAB_DEFS.map(({ key: k, label }) => {
            const active = sTab === k && !q.trim();
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSTab(k)}
                className="relative mr-6 flex h-full shrink-0 items-center text-[15px]"
                style={{ color: active ? t.text : t.secondary, fontWeight: active ? 700 : 500 }}
              >
                {label}
                {active && (
                  <span
                    className="absolute bottom-0 left-1/2 h-[4px] w-12 -translate-x-1/2 rounded-full"
                    style={{ background: t.blue }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {q.trim() ? (
          results.length ? (
            <>
              <p className="px-4 pb-1 pt-2 text-[13px]" style={{ color: t.secondary }}>
                帖子与作者 · {results.length} 条
              </p>
              {results.map((p) => (
                <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
              ))}
            </>
          ) : (
            <EmptyState text={`没有找到「${q.trim()}」相关的帖子，换个关键词试试`} />
          )
        ) : stabCommunity === null ? (
          <>
            <p className="px-4 pb-2 pt-3 text-[20px] font-extrabold">趋势</p>
            {trends.map((tr, i) => (
              <button
                key={tr.tag}
                type="button"
                onClick={() => setQ(`#${tr.tag}#`)}
                className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors active:opacity-60"
                style={{ borderColor: t.border }}
              >
                <span className="w-6 pt-[2px] text-[15px] font-extrabold" style={{ color: t.secondary }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]" style={{ color: t.secondary }}>
                    论坛热议
                  </span>
                  <span className="block truncate text-[15px] font-bold">#{tr.tag}#</span>
                  <span className="block text-[13px]" style={{ color: t.secondary }}>
                    {countShort(tr.count * 860 + 120)} 条帖子
                  </span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <p className="px-4 pb-1 pt-3 text-[13px]" style={{ color: t.secondary }}>
              {sTab === 'foryou' ? '为你推荐 · 你可能感兴趣的新帖' : `${STAB_DEFS.find((x) => x.key === sTab)?.label} · 来自版块的热门帖子`}
            </p>
            {tabPosts.length ? (
              tabPosts.map((p) => <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />)
            ) : (
              <EmptyState text="还没有帖子，去发一条开个张吧" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 社区列表 ----------------

export function CommunitiesView() {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  // 「今日热议」= 广场概念（与首页「为你推荐」重复），已按用户要求从社区列表移除
  const mine = COMMUNITY_DEFS.filter((c) => c.id !== 'hot' && d.communities.find((x) => x.id === c.id)?.joined);
  const rest = COMMUNITY_DEFS.filter((c) => c.id !== 'hot' && !d.communities.find((x) => x.id === c.id)?.joined);

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      <PageHead
        title="社区"
        right={
          <button
            type="button"
            aria-label="社区说明"
            onClick={() => f.toast('加入版块后，版块帖子会出现在你的广场里')}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.settings(22)}
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <p className="px-4 pb-1 pt-3 text-[17px] font-extrabold">我的社区</p>
        {mine.length === 0 && <EmptyState text="还没有加入任何版块" />}
        {mine.map((c) => (
          <CommunityRow key={c.id} id={c.id} joined />
        ))}
        <p className="px-4 pb-1 pt-4 text-[17px] font-extrabold">发现社区</p>
        {rest.map((c) => (
          <CommunityRow key={c.id} id={c.id} />
        ))}
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          版块会随论坛发展陆续开放
        </p>
      </div>
    </div>
  );
}

function CommunityRow({ id, joined }: { id: string; joined?: boolean }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const def = COMMUNITY_DEFS.find((c) => c.id === id)!;
  const isJoined = !!d.communities.find((x) => x.id === id)?.joined;
  return (
    <button
      type="button"
      onClick={() => f.openCommunity(id)}
      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors active:opacity-60"
      style={{ borderColor: t.border }}
    >
      <CommunityIcon id={id} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold">{def.name}</span>
        <span className="block text-[13px]" style={{ color: t.secondary }}>
          {countShort(def.members)} 成员
        </span>
        <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
          {def.desc}
        </span>
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          const nd = forumData();
          const slot = nd.communities.find((x) => x.id === id);
          if (slot) slot.joined = !slot.joined;
          saveForum({ ...nd });
          f.toast(slot?.joined ? `已加入「${def.name}」` : `已退出「${def.name}」`);
        }}
        className="flex h-[32px] shrink-0 items-center rounded-full px-4 text-[14px] font-bold active:opacity-60"
        style={
          isJoined
            ? { border: `1px solid ${t.border}`, color: t.text, background: 'transparent' }
            : { background: t.text, color: t.bg, border: 'none' }
        }
        role="button"
        aria-label={isJoined ? `退出${def.name}` : `加入${def.name}`}
      >
        {isJoined ? '已加入' : '加入'}
      </span>
    </button>
  );
}

// ---------------- 社区页（版块内帖子流） ----------------

export function CommunityPage({ id }: { id: string }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const def = COMMUNITY_DEFS.find((c) => c.id === id) ?? COMMUNITY_DEFS[0];
  const isJoined = !!d.communities.find((x) => x.id === id)?.joined;
  // 直算不 memo：数据对象会被引擎原位变更（点赞/转推），memo 依赖不可靠（react-hooks 规则）
  // 仅展示主帖（回复只出现在帖子详情页，不混入版块流）；隐藏帖（不感兴趣/举报）与未到点的定时帖不展示
  const posts = d.posts
    .filter((p) => p.replyTo === null && (p.community ?? 'hot') === id && isPostVisible(p))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      <div
        className="sticky top-0 z-20 shrink-0"
        style={{ background: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3 px-3 pt-[54px]" style={{ height: 104 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[18px] font-bold">{def.name}</span>
            <span className="block text-[12px]" style={{ color: t.secondary }}>
              {countShort(def.members)} 成员 · {posts.length} 帖
            </span>
          </div>
          <span
            onClick={() => {
              const nd = forumData();
              const slot = nd.communities.find((x) => x.id === id);
              if (slot) slot.joined = !slot.joined;
              saveForum({ ...nd });
              f.toast(slot?.joined ? `已加入「${def.name}」` : `已退出「${def.name}」`);
            }}
            className="flex h-[32px] shrink-0 items-center rounded-full px-4 text-[14px] font-bold active:opacity-60"
            style={
              isJoined
                ? { border: `1px solid ${t.border}`, color: t.text, background: 'transparent' }
                : { background: t.text, color: t.bg }
            }
            role="button"
            aria-label={isJoined ? `退出${def.name}` : `加入${def.name}`}
          >
            {isJoined ? '已加入' : '加入'}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {posts.length ? (
          posts.map((p) => <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />)
        ) : (
          <EmptyState text="这个版块还没有帖子，发一条开个张吧" />
        )}
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          已经到底啦
        </p>
      </div>
    </div>
  );
}

// ---------------- 通知 ----------------

export function NotificationsView() {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();

  // 打开页 600ms 后全部标记已读（X：看过即消点）
  useEffect(() => {
    const hasUnread = forumData().notifications.some((n) => !n.read);
    if (!hasUnread) return;
    const timer = window.setTimeout(() => {
      const nd = forumData();
      nd.notifications = nd.notifications.map((n) => (n.read ? n : { ...n, read: true }));
      saveForum({ ...nd });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [d.notifications.length]);

  const items = [...d.notifications].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      <PageHead title="通知" />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {items.length === 0 && <EmptyState text="暂无通知，发条帖子让大家认识你" />}
        {items.map((n) => {
          const a = resolveAuthor(n.fromKey);
          const post = n.postId ? d.posts.find((p) => p.id === n.postId) : undefined;
          const target: ForumPost | undefined = post;
          // v43（C4）【记忆梗】：在TA帖下留过多次言的「老熟人」回访时，通知文案
          // 偶尔换成认脸版（「xxx 又来了」）——按通知 id 哈希稳定选择，重渲染不闪烁
          const veteranReply =
            n.type === 'reply' &&
            isNpcVeteran(n.fromKey) &&
            [...n.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 10 < 4;
          const iconColor =
            n.type === 'like' ? t.pink : n.type === 'reply' ? t.blue : n.type === 'repost' ? t.green : n.type === 'follow' ? t.blue : t.blue;
          const icon =
            n.type === 'like' ? (
              <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            ) : n.type === 'reply' ? (
              <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden="true">
                <path d="M12 3C6.5 3 2 6.6 2 11c0 2.2 1.2 4.2 3.1 5.6-.2 1.2-.9 2.3-1.9 3.1 1.8-.1 3.5-.8 4.9-1.9 1.2.3 2.5.5 3.9.5 5.5 0 10-3.6 10-8s-4.5-8-10-8z" />
              </svg>
            ) : n.type === 'follow' ? (
              /* v44【AI 关注者】：人形+号（X 官方关注通知图标） */
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4.5 20c.8-3.2 3.6-5 7.5-5s6.7 1.8 7.5 5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18.5 5v6M15.5 8h6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
              </svg>
            );
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                // v44【AI 关注者】：关注通知 → 点开 TA 的主页（无帖子可跳）
                if (n.type === 'follow') {
                  f.openProfile(n.fromKey);
                  return;
                }
                if (!target) return;
                if (n.type === 'reply') f.openThread(target.replyTo ?? target.id);
                else f.openThread(target.id);
              }}
              className="flex w-full gap-3 border-b px-4 py-3 text-left transition-colors active:opacity-60"
              style={{
                borderColor: t.border,
                background: n.read ? 'transparent' : t.dark ? 'rgba(29,155,240,0.08)' : 'rgba(29,155,240,0.06)',
              }}
            >
              <span className="shrink-0 pt-[2px]" style={{ color: iconColor }}>
                {icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug" style={{ color: t.text }}>
                  {n.type === 'system'
                    ? n.text
                    : n.type === 'like'
                      ? `${a.name} 赞了你的帖子`
                      : n.type === 'reply'
                        ? veteranReply
                          ? `${a.name} 又来了：回复了你`
                          : `${a.name} 回复了你`
                        : n.type === 'follow'
                          ? `${a.name} 关注了你`
                          : `${a.name} 转推了你的帖子`}
                </span>
                {(target || n.type === 'follow') && (
                  <span className="mt-[2px] block truncate text-[14px]" style={{ color: t.secondary }}>
                    {n.type === 'follow'
                      ? '互相关注一下？点开 TA 的主页看看'
                      : target
                        ? target.content
                        : ''}
                  </span>
                )}
                <span className="mt-[2px] block text-[12px]" style={{ color: t.secondary }}>
                  {relTime(n.createdAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
