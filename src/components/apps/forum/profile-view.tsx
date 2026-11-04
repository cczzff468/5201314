'use client';

/**
 * X论坛 · 个人主页（X profile，按官方截图精修）。
 * 顶栏：返回 + 名字(bold) + 蓝V + 「N 帖子」副标题 + 右侧搜索图标；
 *   搜索图标 = 页内搜索（过滤下方 帖子/回复/转推/媒体 四个 tab 的内容），
 *   点击后半透明标题区变为搜索输入胶囊，✕ 退出（不再跳转全局搜索 tab）。
 * 横幅 150px（背景图改在「编辑资料」里从手机上传，横幅本身无按钮）+
 * 80px 头像上半部分叠在背景图上（X 官方样式：头像负边距 -40px 压在横幅上，
 * 上半 40px 在背景图上、下半 40px 在横幅下方，头像绘制在横幅之上）+
 * 按钮排（他人：…/信封/关注黑胶囊；
 * 自己：编辑资料描边胶囊 → 编辑资料弹层，名字/账号/简介/关注数/头像/背景均可自定义）+
 * 「获得认证」浅蓝胶囊 + Joined 行 + 「N 正在关注 N 关注者」统计 + 四 tab
 * （帖子▼/回复/转推/媒体，蓝下划线；自己的「回复」= 别人回复我的；
 * 自己的「转推」= 我转推过的帖子）。
 */

import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, VenetianMask, X } from 'lucide-react';
import {
  ANON_KEY,
  followersOf,
  forumData,
  forumSnapshot,
  isPostVisible,
  isUserAuthor,
  myFollowingCount,
  postsOf,
  resolveAuthor,
  saveForum,
  subscribeForum,
  switchForumAccount,
  type AuthorKey,
  type ForumPost,
} from '@/lib/forum/core';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostCard, EmptyState } from './feed';
import { EditProfileSheet } from './profile-edit';

type PTab = 'posts' | 'replies' | 'reposts' | 'media';
const PTABS: [PTab, string][] = [
  ['posts', '帖子'],
  ['replies', '回复'],
  ['reposts', '转推'],
  ['media', '媒体'],
];

export function ProfileView({ authorKey }: { authorKey: AuthorKey }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const a = resolveAuthor(authorKey);
  // 大号与匿名小号都是「我自己」的主页（编辑资料/切换按钮/回复 tab 语义同源）
  const isMe = isUserAuthor(authorKey);
  const isAnonProfile = authorKey === ANON_KEY;
  const followed = d.following.includes(authorKey);
  const [pTab, setPTab] = useState<PTab>('posts');
  const [editing, setEditing] = useState(false);
  /** 页内搜索：激活后顶栏变输入胶囊，过滤当前 tab 内容 */
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  // 直算不 memo：数据对象会被引擎原位变更，memo 依赖不可靠（react-hooks 规则）。
  // 列表统一走 isPostVisible：被「不感兴趣/举报」隐藏与未到时间的定时帖不在主页展示。
  const all = postsOf(d, authorKey).filter((p) => isPostVisible(p));
  const ownPosts = all.filter((p) => p.replyTo === null);
  const replyPosts = all.filter((p) => p.replyTo !== null);
  // 「回复」tab（自己的主页）：别人回复我的（回复我任何帖/评论的），非我评论别人的
  // v7：按真实 parentId（replyToPost，缺省回退 replyTo）判定——别人在我的楼中楼
  // 下的任何一层回复（哪怕锚点挂在别人的评论分组上）都能正确算作「回复了我」。
  // 匿名小号主页：只算小号自己的帖/评论（与大号数据完全隔离）。
  const myPostIdSet = new Set(d.posts.filter((p) => p.authorKey === authorKey).map((p) => p.id));
  const repliesToMe = d.posts
    .filter(
      (p) => !isUserAuthor(p.authorKey) && p.replyTo !== null && myPostIdSet.has(p.replyToPost ?? p.replyTo) && isPostVisible(p),
    )
    .sort((x, y) => y.createdAt - x.createdAt);
  // 「转推」tab（自己的主页）：我转推过的帖子
  const myReposts = d.posts.filter((p) => p.reposted === true && isPostVisible(p)).sort((x, y) => y.createdAt - x.createdAt);
  // 「媒体」tab：带附图的帖子 → 3 列方图网格（X 官方媒体墙）
  const mediaPosts = all.filter((p) => (p.media ?? []).length > 0);
  // 加入时间：大号 = 论坛注册时刻；匿名小号 = 小号创建时刻
  const joined = new Date(isAnonProfile ? (d.anon?.createdAt ?? d.joinedAt) : d.joinedAt);
  const joinedLabel = `${joined.getFullYear()}年${joined.getMonth() + 1}月加入`;
  const myBanner = isMe ? (isAnonProfile ? d.anon?.profile?.banner : d.profile?.banner) : undefined;
  /** 真人主页（自己/联系人）无自定义背景时的默认横幅（精致渐变艺术图）；NPC 用品牌色渐变 */
  const useDefaultBanner = !myBanner && (isMe || authorKey.startsWith('char:'));
  const bannerBg = a.npcAvatar?.bg ?? (authorKey.startsWith('char:') ? '#5b7d9e' : '#657786');
  // v7 用户要求：正在关注/关注者默认 0——自己 = 真实关注数，其他人 = 0（不造假数）；
  // 关注者同样默认 0（followersOf：仅内置认证大 V 保留粉丝基数）。
  // 匿名小号与大号共用关注列表（X 同设备双号语义，关注是设备行为）。
  const followingCount = isMe ? myFollowingCount(d) : 0;

  /** 页内搜索关键词过滤（当前 tab 的列表） */
  const kw = q.trim().toLowerCase();
  const hit = (list: ForumPost[]) => (kw ? list.filter((p) => p.content.toLowerCase().includes(kw)) : list);
  const tabLabel = PTABS.find(([k]) => k === pTab)?.[1] ?? '帖子';

  /** 当前 tab 的列表内容（搜索时先按关键词过滤） */
  const list = hit(ownPosts).map((p) => <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />);
  const repliesList = hit(isMe ? repliesToMe : replyPosts).map((p) => (
    <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
  ));
  const repostsList = isMe
    ? hit(myReposts).map((p) => <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />)
    : [];

  const toggleFollow = () => {
    const nd = forumData();
    if (followed) nd.following = nd.following.filter((k) => k !== authorKey);
    else nd.following = [...nd.following, authorKey];
    f.toast(followed ? `已取消关注 ${a.name}` : `已关注 ${a.name}，「关注」页将出现 TA 的帖子`);
    saveForum({ ...nd });
  };

  /** 搜索态下的无结果文案 */
  const searchEmpty = (tab: string) => `没有找到与「${q.trim()}」相关的${tab}`;

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏：返回 + 名字/帖子数 + 搜索（半透明悬浮在横幅上）；
          搜索态：中间标题区换为搜索输入胶囊，右侧 ✕ 退出 */}
      <div
        className="sticky top-0 z-20"
        style={{ background: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)', backdropFilter: 'blur(8px)' }}
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
          {searching ? (
            <>
              <label
                className="flex h-[40px] min-w-0 flex-1 items-center gap-2 rounded-full px-3"
                style={{ background: t.dark ? '#202327' : '#eff3f4' }}
              >
                <span className="shrink-0" style={{ color: t.secondary }}>
                  {XIcons.search(18)}
                </span>
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`搜索${tabLabel}（${a.name} 的主页）`}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                  style={{ color: t.text, caretColor: t.blue }}
                  aria-label={`搜索${tabLabel}`}
                />
                {q && (
                  <button
                    type="button"
                    aria-label="清空关键词"
                    onClick={() => setQ('')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: t.secondary, color: t.bg }}
                  >
                    <X width={12} height={12} strokeWidth={3} aria-hidden="true" />
                  </button>
                )}
              </label>
              <button
                type="button"
                aria-label="退出搜索"
                onClick={() => {
                  setSearching(false);
                  setQ('');
                }}
                className="shrink-0 text-[15px] font-medium active:opacity-60"
                style={{ color: t.blue }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-[17px] font-bold">
                  <span className="truncate">{a.name}</span>
                  {a.verified && <VerifiedBadge size={15} />}
                </span>
                <span className="block text-[13px]" style={{ color: t.secondary }}>
                  {ownPosts.length} 帖子
                </span>
              </div>
              <button
                type="button"
                aria-label={`搜索${a.name}的${tabLabel}`}
                onClick={() => setSearching(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                style={{ color: t.text }}
              >
                {XIcons.search(21)}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* 横幅（150px，X 官方比例；背景图在「编辑资料」里上传；未上传时真人主页用默认艺术横幅） */}
        <div
          className="relative h-[150px] w-full shrink-0 overflow-hidden"
          style={useDefaultBanner || myBanner ? undefined : { background: `linear-gradient(135deg, ${bannerBg}, ${t.dark ? '#1b2733' : '#c9d6e2'})` }}
        >
          {myBanner ? (
            <img src={myBanner} alt="主页背景图" className="h-full w-full object-cover" />
          ) : useDefaultBanner ? (
            <img src="/forum-default-banner.svg" alt="默认背景图" className="h-full w-full object-cover" />
          ) : null}
        </div>
        {/* 头像 + 操作排（用户要求：头像上半部分叠在背景图上——X 官方样式，
            头像 80px 以负边距 -40px 上移，上半 40px 压在横幅之上；
            容器需 relative z-10：横幅为定位元素，否则头像会被横幅盖住） */}
        <div className="relative z-10 px-4">
          <div className="-mt-[40px] flex items-end justify-between">
            <XAvatar authorKey={authorKey} size={80} />
            <div className="flex items-center gap-2">
              {isMe ? (
                <>
                  {/* 【匿名账号】大号主页 → 切换到匿名小号；小号主页 → 切回大号。
                      切到小号后发帖/评论/点赞/私信都以「匿名者」身份发生（数据完全隔离）。
                      v42：用 replace 替换栈顶——切换后点一次返回直接回主界面（旧版 push 会退两层） */}
                  <button
                    type="button"
                    aria-label={isAnonProfile ? '切回主账号' : '切换匿名账号'}
                    onClick={() => {
                      const to = isAnonProfile ? 'main' : 'anon';
                      const switched = switchForumAccount(to);
                      if (switched === 'anon') {
                        const anon = resolveAuthor(ANON_KEY);
                        f.toast(`已切换到匿名账号 @${anon.handle}，发帖/评论/点赞都以匿名者身份发生`);
                        f.replace({ kind: 'profile', key: ANON_KEY });
                      } else {
                        f.toast('已切回主账号（大号）');
                        f.replace({ kind: 'profile', key: 'user' });
                      }
                    }}
                    className="flex h-[34px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold transition-opacity active:opacity-60"
                    style={{
                      borderColor: isAnonProfile ? (t.dark ? '#536471' : '#cfd9de') : t.border,
                      color: isAnonProfile ? t.text : t.blue,
                      background: isAnonProfile ? 'transparent' : 'rgba(29,155,240,0.08)',
                    }}
                  >
                    <VenetianMask width={15} height={15} strokeWidth={2.1} aria-hidden="true" />
                    {isAnonProfile ? '切回大号' : '切换匿名账号'}
                  </button>
                  <button
                    type="button"
                    aria-label="编辑资料"
                    onClick={() => setEditing(true)}
                    className="flex h-[34px] items-center rounded-full border px-4 text-[14px] font-bold transition-opacity active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    编辑资料
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="更多操作"
                    onClick={() => f.toast('已收到反馈，感谢让论坛更好')}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border transition-colors active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    {XIcons.more(18)}
                  </button>
                  <button
                    type="button"
                    aria-label="发私信"
                    onClick={() => f.openDm(authorKey)}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border transition-colors active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={followed ? '取消关注' : '关注'}
                    onClick={toggleFollow}
                    className="flex h-[34px] items-center rounded-full px-5 text-[14px] font-bold transition-opacity active:opacity-60"
                    style={
                      followed
                        ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
                        : { background: t.text, color: t.bg, border: 'none' }
                    }
                  >
                    {followed ? '已关注' : '关注'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 名字 / 账号 / 认证 / 简介 / 统计 */}
          <div className="mt-3">
            <div className="flex items-center gap-1">
              <h1 className="text-[20px] font-extrabold leading-tight">{a.name}</h1>
              {a.verified && <VerifiedBadge size={16} />}
              {/* 匿名小号标识（仅自己可见的身份提示：当前正在用小号冲浪） */}
              {isMe && isAnonProfile && (
                <span
                  className="ml-1 flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-bold"
                  style={{ background: 'rgba(29,155,240,0.12)', color: t.blue }}
                >
                  <VenetianMask width={11} height={11} strokeWidth={2.4} aria-hidden="true" /> 匿名账号
                </span>
              )}
            </div>
            <p className="text-[14px]" style={{ color: t.secondary }}>
              @{a.handle}
            </p>
            {a.bio && <p className="mt-2 text-[15px] leading-snug">{a.bio}</p>}
            <p className="mt-2 flex items-center gap-1 text-[14px]" style={{ color: t.secondary }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
              </svg>
              {joinedLabel}
            </p>
            {/* v44【AI 关注者】：统计行可点——自己的主页进「正在关注/关注者」列表
                （取消关注/查看谁关注了我）；联系人的「关注者」也可看（列表里是否有我）；
                内置大V 的粉丝是平台数据不可列表，不响应点击 */}
            <p className="mt-2 flex items-center gap-3 text-[14px]" style={{ color: t.secondary }}>
              <button
                type="button"
                onClick={() => isMe && f.openFollowList(authorKey, 'following')}
                aria-label={isMe ? '查看我正在关注的人' : undefined}
                className={`transition-opacity ${isMe ? 'active:opacity-60' : 'cursor-default'}`}
              >
                <span style={{ color: t.text, fontWeight: 700 }}>{followingCount.toLocaleString()}</span> 正在关注
              </button>
              <button
                type="button"
                onClick={() => !authorKey.startsWith('npc:') && !authorKey.startsWith('mnpc:') && f.openFollowList(authorKey, 'followers')}
                aria-label={isMe ? '查看谁关注了我' : undefined}
                className={`transition-opacity ${!authorKey.startsWith('npc:') && !authorKey.startsWith('mnpc:') ? 'active:opacity-60' : 'cursor-default'}`}
              >
                <span style={{ color: t.text, fontWeight: 700 }}>{followersOf(authorKey).toLocaleString()}</span> 关注者
              </button>
            </p>
          </div>

          {/* 四 tab（X：帖子▼/回复/转推/媒体，蓝下划线） */}
          <div className="mt-3 flex items-stretch border-b" style={{ borderColor: t.border }}>
            {PTABS.map(([k, label]) => {
              const active = pTab === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPTab(k)}
                  className="relative flex h-[44px] flex-1 items-center justify-center gap-1 text-[15px]"
                  style={{ color: active ? t.text : t.secondary, fontWeight: active ? 800 : 500 }}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                  {k === 'posts' && <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden="true" />}
                  {active && (
                    <span
                      className="absolute bottom-0 left-1/2 h-[4px] w-14 -translate-x-1/2 rounded-full"
                      style={{ background: t.blue }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* 搜索结果提示行 */}
          {searching && kw && (
            <p className="px-1 pb-1 pt-2 text-[13px]" style={{ color: t.secondary }}>
              {tabLabel}中找到 {pTab === 'posts'
                ? hit(ownPosts).length
                : pTab === 'replies'
                  ? hit(isMe ? repliesToMe : replyPosts).length
                  : pTab === 'reposts'
                    ? hit(myReposts).length
                    : hit(mediaPosts).length}{' '}
              条与「{q.trim()}」相关的内容
            </p>
          )}

          {/* tab 内容（搜索时按关键词过滤） */}
          {pTab === 'posts' &&
            (list.length ? (
              list
            ) : (
              <EmptyState text={kw ? searchEmpty('帖子') : isMe ? '还没有发过帖子，点右下角蓝色按钮发一条吧' : 'TA 还没有发过帖子'} />
            ))}
          {pTab === 'replies' &&
            (repliesList.length ? (
              repliesList
            ) : (
              <EmptyState
                text={
                  kw
                    ? searchEmpty('回复')
                    : isMe
                      ? '别人回复你的内容会出现在这里，多发帖和大家聊聊吧'
                      : 'TA 还没有回复过别人'
                }
              />
            ))}
          {pTab === 'reposts' &&
            (isMe ? (
              repostsList.length ? (
                repostsList
              ) : (
                <EmptyState
                  text={kw ? searchEmpty('转推') : '转推过的帖子会出现在这里，点帖子下方的循环箭头试试'}
                />
              )
            ) : (
              <EmptyState text="TA 还没有转推" />
            ))}
          {pTab === 'media' &&
            (mediaPosts.length ? (
              /* X 官方媒体墙：3 列方图网格（搜索关键词过滤），点开对应帖子 */
              <div className="grid grid-cols-3 gap-[3px] pt-[3px]">
                {hit(mediaPosts).flatMap((p) =>
                  (p.media ?? []).map((m, i) => (
                    <button
                      key={`${p.id}-${i}`}
                      type="button"
                      onClick={() => f.openThread(p.id)}
                      className="relative aspect-square overflow-hidden"
                      aria-label={`查看${resolveAuthor(p.authorKey).name}的媒体帖子`}
                    >
                      <img src={m} alt="媒体帖子" className="h-full w-full select-none object-cover transition-transform active:scale-95" loading="lazy" />
                      {(p.media ?? []).length > 1 && i === 0 && (
                        <span
                          className="absolute right-1.5 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-black/55 text-[11px] font-bold text-white"
                          aria-hidden="true"
                        >
                          {p.media!.length}
                        </span>
                      )}
                    </button>
                  )),
                )}
              </div>
            ) : (
              <EmptyState text={kw ? searchEmpty('媒体') : isMe ? '帖子附带的图片会出现在这里，发布时添加图片试试' : 'TA 还没有媒体内容'} />
            ))}
          <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
            已经到底啦
          </p>
        </div>
      </div>

      {/* 编辑资料弹层（大号/匿名小号各自隔离的资料编辑） */}
      {editing && <EditProfileSheet account={isAnonProfile ? 'anon' : 'main'} onClose={() => setEditing(false)} />}
    </div>
  );
}
