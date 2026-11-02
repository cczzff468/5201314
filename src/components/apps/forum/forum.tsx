'use client';

/**
 * X论坛 App · 主框架。
 *
 * - 主页顶栏（X 官方规格）：左 32px 头像（开侧边抽屉）/ 中 𝕏 Logo / 右「订阅」描边胶囊；
 *   下方独立 tab 行「为你推荐|关注|分类标签…」（左对齐 + 蓝色圆头下划线，标签多时换行铺开——
 *   用户要求：所有界面禁止左右滑动）+ 右侧 + 号（添加/管理分类标签，勾选后作为附加 tab 筛选版块帖子）；
 *   sticky backdrop-blur 半透明（X header 观感）。
 * - 底部 5 tab（X 图标底栏，无文字标签）：主页/搜索/社区/通知/私信，
 *   选中黑实心（深色模式白，X 官方行为）、未选灰。
 * - 右下蓝色发布 FAB（X 圆形 #1d9bf0 + 白色编辑笔）。
 * - 页面栈：thread / profile / community / dm 整页层从右滑入（X push 观感），返回即 pop；
 *   主 tab 层保持挂载（返回后 feed 滚动位置不丢）。
 * - 抽屉（X 侧滑）：个人摘要 + 菜单（个人资料 / 去社区 / 重置论坛数据 / 关于）。
 * - 顶部 pt-[54px] 让出状态栏；底栏 pb-[16px] 让出 Home 横杠（与微信等 App 同口径）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, Check, Flag, Sparkles, EyeOff } from 'lucide-react';
import {
  COMMUNITY_DEFS,
  communityName,
  countShort,
  forumData,
  forumSnapshot,
  followersOf,
  isPostVisible,
  myFollowingCount,
  refreshForumAuthors,
  resolveAuthor,
  saveForum,
  subscribeForum,
  castVote as castVoteCore,
  hidePost,
  uid,
  type ForumPost,
  POST_MAX,
} from '@/lib/forum/core';
import { bootForum, generateMoreFeedPosts, generateNewFeedPosts, queueUserPostInteractions, queueCharEngagements, queueCharThanksForLike, setForumAiActivity } from '@/lib/forum/engine';
import { writeUserLikeMemory, writeUserPostMemory } from '@/lib/forum/social';
import {
  COMMENT_COUNT_BOUNDS,
  POST_COUNT_BOUNDS,
  countPromptOverrides,
  getForumGenSettings,
  setCommentCountRange,
  setPostCountRange,
} from '@/lib/forum/gen-settings';
import { FORUM_PROMPT_DEFS } from '@/lib/forum/prompt-defs';
// 【多世界观】世界观切换 / NPC 矩阵 / AI 规则面板 + store 订阅（首页标签实时读）
import { subscribeWorldview, worldviewSnapshot, countCustomRules } from '@/lib/forum/worldview-store';
import { GenRangeRow, PromptSheet } from './prompt-sheet';
import { WorldviewSheet } from './worldview-sheet';
import { NpcMatrixSheet, RulesSheet } from './npc-sheet';
import { XAvatar, XIcons, XLogo, WorldviewIcon, useXTheme } from './shared';
import { FeedList, FeedSkeleton, CommunityIcon } from './feed';
import { ComposeSheet, type ComposePayload } from './compose-sheet';
import { ThreadView } from './thread-view';
import { ProfileView } from './profile-view';
import { SearchView, CommunitiesView, CommunityPage, NotificationsView } from './extras';
import { DmsView, DmThread } from './dms';
import { ForumCtx, type ViewSpec } from './ctx';

type Tab = 'home' | 'search' | 'communities' | 'notifications' | 'dms';
const TABS: Tab[] = ['home', 'search', 'communities', 'notifications', 'dms'];

/** 过界拖拽手势（用户要求：滑到最后一个帖子不生成，继续上滑并「松开」才生成；
 *  顶部同理：滑到最上面下拉松开生成新内容）。
 *  原始行程达到 PULL_THRESHOLD 且松开才触发；视觉行程有阻尼（橡胶手感）。 */
const PULL_THRESHOLD = 72;
const PULL_RESIST = 0.6;
const PULL_MAX_VIS = 84;
const VIS_THRESHOLD = Math.round(PULL_THRESHOLD * PULL_RESIST);

/** 动画 keyframes（推入页右滑入 / 遮罩淡入 / 抽屉左滑入） */
const KEYFRAMES = `
@keyframes forum-in { from { transform: translateX(60%); opacity: .4 } to { transform: translateX(0); opacity: 1 } }
@keyframes forum-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes forum-drawer { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes forum-sheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
.forum-hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.forum-hide-scrollbar::-webkit-scrollbar { display: none; }
.forum-gen-scroll { scrollbar-width: thin; scrollbar-color: rgba(120,120,128,0.4) transparent; }
.forum-gen-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
.forum-gen-scroll::-webkit-scrollbar-thumb { background: rgba(120,120,128,0.4); border-radius: 4px; }
.forum-gen-scroll::-webkit-scrollbar-track { background: transparent; }
`;

export default function ForumApp() {
  const t = useXTheme();
  /** v33【AI 真人社交】活跃度开关状态（从 ForumData 派生；saveForum 后自动刷新） */
  const aiActivity = forumData().aiActivity !== false;
  const [authorsReady, setAuthorsReady] = useState(false);
  const [tab, setTabRaw] = useState<Tab>('home');
  const [views, setViews] = useState<ViewSpec[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [compose, setCompose] = useState(false);
  /** v34 生成设置：每次生成帖子/评论条数范围（抽屉步进行）+ 提示词面板开关 */
  const [genUi, setGenUi] = useState(() => {
    const s = getForumGenSettings();
    return { pMin: s.postCountMin, pMax: s.postCountMax, cMin: s.commentCountMin, cMax: s.commentCountMax };
  });
  const [promptSheet, setPromptSheet] = useState(false);
  /** 已自定义提示词条数（入口摘要；提示词面板关闭时刷新） */
  const [ovCount, setOvCount] = useState(() => countPromptOverrides());
  /** 【多世界观】三个管理面板开关 + 规则自定义条数角标 */
  const [worldSheet, setWorldSheet] = useState(false);
  const [npcSheet, setNpcSheet] = useState(false);
  const [rulesSheet, setRulesSheet] = useState(false);
  const [rulesCount, setRulesCount] = useState(() => countCustomRules());
  /** 生成设置镜像 ref：步进处理器里同步更新——同一事件循环里连点也逐级累加 */
  const genUiRef = useRef(genUi);
  useEffect(() => {
    genUiRef.current = genUi;
  }, [genUi]);
  /** 范围步进：钳制 + min/max 推挤 + 立即落库（下一次生成就用新范围） */
  const bumpGenRange = useCallback((kind: 'posts' | 'comments', which: 'min' | 'max', d: number) => {
    const g = genUiRef.current;
    const bounds = kind === 'posts' ? POST_COUNT_BOUNDS : COMMENT_COUNT_BOUNDS;
    let min = kind === 'posts' ? g.pMin : g.cMin;
    let max = kind === 'posts' ? g.pMax : g.cMax;
    if (which === 'min') {
      min = Math.min(Math.max(min + d, bounds.min), bounds.max);
      if (min > max) max = min;
    } else {
      max = Math.min(Math.max(max + d, bounds.min), bounds.max);
      if (max < min) min = max;
    }
    const s = kind === 'posts' ? setPostCountRange(min, max) : setCommentCountRange(min, max);
    const next = { pMin: s.postCountMin, pMax: s.postCountMax, cMin: s.commentCountMin, cMax: s.commentCountMax };
    genUiRef.current = next;
    setGenUi(next);
  }, []);
  const [tagPicker, setTagPicker] = useState(false);
  const [homeTab, setHomeTab] = useState<string>('foryou');
  const [toastMsg, setToastMsg] = useState<{ id: number; text: string } | null>(null);
  /** 主页无限生成（过界手势）：滑到底后继续上滑、松开 → 生成 7~20 条（追加下方，旧帖永不消失）；
   *  滑到顶后下拉、松开 → 生成 7~20 条新内容（插入最上方）。 */
  const [moreLoading, setMoreLoading] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [pullUpPx, setPullUpPx] = useState(0);
  const [pullDownPx, setPullDownPx] = useState(0);
  const [pulling, setPulling] = useState(false);
  const homeScrollRef = useRef<HTMLDivElement | null>(null);
  const moreLoadingRef = useRef(false);
  const topLoadingRef = useRef(false);
  const gestureRef = useRef<{ mode: null | 'up' | 'down'; startY: number; lastY: number; pull: number }>({
    mode: null,
    startY: 0,
    lastY: 0,
    pull: 0,
  });
  /** 帖子「···」底部菜单：当前操作的帖子（null = 关闭） */
  const [menuPost, setMenuPost] = useState<ForumPost | null>(null);
  /** 定时发布到期重绘 tick（30s；到点的帖子自动出现在列表顶部） */
  const [tick, setTick] = useState(0);

  // 数据订阅（rev 变化触发重渲）
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);

  // 启动：作者快照（联系人/机主名头像）→ 引擎（播种/补新帖/跑 pending）
  useEffect(() => {
    let alive = true;
    void (async () => {
      await refreshForumAuthors();
      if (!alive) return;
      setAuthorsReady(true);
      await bootForum();
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toast = useCallback((text: string) => {
    setToastMsg({ id: Date.now(), text });
  }, []);

  /** 底部生成（上拉松开触发 / footer 点击兜底） */
  const doGenerateMore = useCallback(() => {
    if (moreLoadingRef.current) return;
    moreLoadingRef.current = true;
    setMoreLoading(true);
    void generateMoreFeedPosts()
      .then((n) => {
        if (n > 0) toast(`已为你生成 ${n} 条帖子`);
      })
      .finally(() => {
        moreLoadingRef.current = false;
        setMoreLoading(false);
      });
  }, [toast]);

  /** 顶部生成（下拉松开触发）：新内容整批插入信息流最上方 */
  const doGenerateFresh = useCallback(() => {
    if (topLoadingRef.current) return;
    topLoadingRef.current = true;
    setTopLoading(true);
    void generateNewFeedPosts()
      .then((n) => {
        if (n > 0) toast(`已为你生成 ${n} 条新内容`);
      })
      .finally(() => {
        topLoadingRef.current = false;
        setTopLoading(false);
      });
  }, [toast]);

  /** 过界拖拽：按住起点（touch/mouse 通用，坐标 = clientY） */
  const gestureBegin = useCallback((y: number) => {
    const g = gestureRef.current;
    g.startY = y;
    g.lastY = y;
    g.pull = 0;
    g.mode = null;
  }, []);

  /** 过界拖拽移动：仅在「已贴底且继续上滑」或「已贴顶且继续下拉」时累计行程；
   *  中途滚回边界内（模式失效）自动取消。底部展开区会撑高 scrollHeight，
   *  边界判断需把展开高度算进余量，否则手势会被自己取消。 */
  const gestureMove = useCallback((y: number) => {
    const g = gestureRef.current;
    const el = homeScrollRef.current;
    if (!el) return;
    if (g.mode === null) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
      const atTop = el.scrollTop < 6;
      if (y < g.startY - 10 && atBottom) {
        g.mode = 'up';
        g.lastY = y;
        setPulling(true);
      } else if (y > g.startY + 10 && atTop) {
        g.mode = 'down';
        g.lastY = y;
        setPulling(true);
      } else {
        return;
      }
    }
    let delta = y - g.lastY; // 手指向下为正
    g.lastY = y;
    if (g.mode === 'up') delta = -delta; // 上拉行程为正
    g.pull = Math.max(0, g.pull + delta);
    const vis = Math.min(PULL_MAX_VIS, Math.round(g.pull * PULL_RESIST));
    if (g.mode === 'up') {
      const diff = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (diff > 12 + vis) {
        g.mode = null;
        g.pull = 0;
        setPulling(false);
        setPullUpPx(0);
        return;
      }
      setPullUpPx(vis);
    } else {
      if (el.scrollTop > 6) {
        g.mode = null;
        g.pull = 0;
        setPulling(false);
        setPullDownPx(0);
        return;
      }
      setPullDownPx(vis);
    }
  }, []);

  /** 松手：达到阈值才触发生成（fire=false 表示手势被打断，不触发） */
  const gestureEnd = useCallback(
    (fire: boolean) => {
      const g = gestureRef.current;
      const mode = g.mode;
      const reached = g.pull >= PULL_THRESHOLD;
      g.mode = null;
      g.pull = 0;
      setPulling(false);
      setPullUpPx(0);
      setPullDownPx(0);
      if (!fire || !mode || !reached) return;
      if (mode === 'up') doGenerateMore();
      else doGenerateFresh();
    },
    [doGenerateFresh, doGenerateMore],
  );

  // 桌面/预览环境：鼠标按住拖拽同样支持过界手势（底部向上拖 / 顶部向下拖，松开触发）
  useEffect(() => {
    if (tab !== 'home') return;
    const el = homeScrollRef.current;
    if (!el) return;
    let dragging = false;
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      gestureBegin(e.clientY);
    };
    const move = (e: MouseEvent) => {
      if (dragging) gestureMove(e.clientY);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      gestureEnd(true);
    };
    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      el.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [tab, gestureBegin, gestureMove, gestureEnd]);

  // toast 自动消隐（1.9s）
  useEffect(() => {
    if (!toastMsg) return;
    const h = window.setTimeout(() => setToastMsg(null), 1900);
    return () => window.clearTimeout(h);
  }, [toastMsg]);

  // 定时帖到期 tick：每 30s 触发一次重绘，visibleAt 到点的帖子自动现身
  useEffect(() => {
    const hasScheduled = forumData().posts.some((p) => typeof p.visibleAt === 'number');
    if (!hasScheduled) return;
    const h = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(h);
  }, []);

  const push = useCallback((v: ViewSpec) => setViews((s) => [...s, v]), []);
  const pop = useCallback(() => setViews((s) => s.slice(0, -1)), []);
  const openThread = useCallback((postId: string) => push({ kind: 'thread', postId }), [push]);
  const openProfile = useCallback((key: string) => push({ kind: 'profile', key }), [push]);
  const openCommunity = useCallback((id: string) => push({ kind: 'community', id }), [push]);
  const openDm = useCallback((peerKey: string) => push({ kind: 'dm', peerKey }), [push]);
  const gotoTab = useCallback((i: number) => {
    setViews([]);
    setTabRaw(TABS[Math.max(0, Math.min(4, i))]);
  }, []);

  const likeToggle = useCallback((postId: string) => {
    const d = forumData();
    const p = d.posts.find((x) => x.id === postId);
    if (!p) return;
    if (p.likes.includes('user')) p.likes = p.likes.filter((k) => k !== 'user');
    else {
      p.likes = [...p.likes, 'user'];
      // v33【AI 真人社交】：用户给角色的帖子点赞 → 通知角色（写记忆）+ 低概率 TA 来评论区回一句
      if (p.authorKey.startsWith('char:')) {
        writeUserLikeMemory(p.authorKey.slice(5), p);
        queueCharThanksForLike(p);
      }
    }
    saveForum({ ...d });
  }, []);

  const repostToggle = useCallback(
    (postId: string) => {
      const d = forumData();
      const p = d.posts.find((x) => x.id === postId);
      if (!p) return;
      if (p.reposted) {
        p.reposted = false;
        p.reposts = Math.max(0, p.reposts - 1);
        toast('已撤销转推');
      } else {
        p.reposted = true;
        p.reposts += 1;
        toast('已转推');
      }
      saveForum({ ...d });
    },
    [toast],
  );

  /** 发帖（compose 发布回调）：落库 + 触发 AI 互动 + 切回主页顶部。
   *  extras：媒体/投票/位置/定时；定时帖 createdAt=visibleAt（到点才出现在列表）。 */
  const publish = useCallback(
    (text: string, community: string | null, extras?: ComposePayload) => {
      const d = forumData();
      const scheduled = typeof extras?.visibleAt === 'number' && extras.visibleAt > Date.now();
      const post: ForumPost = {
        id: uid('p'),
        authorKey: 'user',
        content: text.slice(0, POST_MAX),
        community: community === 'hot' ? null : community,
        createdAt: scheduled ? extras!.visibleAt! : Date.now(),
        likes: [],
        reposts: 0,
        views: 0,
        replyTo: null,
        replyToName: null,
        media: extras?.media?.length ? extras.media.slice(0, 4) : undefined,
        poll: extras?.poll?.options.length
          ? {
              options: extras.poll.options.slice(0, 4).map((o) => o.slice(0, 25)),
              votes: extras.poll.options.slice(0, 4).map(() => 3 + Math.floor(Math.random() * 42)),
              voted: null,
            }
          : undefined,
        location: extras?.location?.trim() || undefined,
        visibleAt: scheduled ? extras!.visibleAt : undefined,
      };
      d.posts.push(post);
      saveForum({ ...d });
      if (!scheduled) {
        queueUserPostInteractions(post);
        // v33【AI 真人社交】：用户发帖 → 写入全部角色的记忆（「TA今天在论坛发帖说…」）
        // + 每位角色延迟几分钟独立决定要不要点赞/评论（LLM 决策，不秒回）
        writeUserPostMemory(post);
        queueCharEngagements(post);
      }
      setHomeTab('foryou');
      gotoTab(0);
      toast(
        scheduled
          ? `已定时，${new Date(extras!.visibleAt!).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 自动发布`
          : '已发布',
      );
    },
    [gotoTab, toast],
  );

  /** 添加/移除主页分类标签（+ 号：勾选版块 → 作为附加 tab 显示在主页顶部） */
  const toggleTag = useCallback(
    (id: string) => {
      const nd = forumData();
      const cur = nd.pinnedTags ?? [];
      const def = COMMUNITY_DEFS.find((c) => c.id === id);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      nd.pinnedTags = next;
      saveForum({ ...nd });
      setHomeTab((h) => (h === id && !next.includes(id) ? 'foryou' : h));
      toast(next.includes(id) ? `已添加「${def?.name ?? id}」标签` : `已移除「${def?.name ?? id}」标签`);
    },
    [toast],
  );

  const ui = useMemo(
    () => ({
      t,
      push,
      pop,
      openThread,
      openProfile,
      openCommunity,
      openDm,
      toast,
      likeToggle,
      repostToggle,
      gotoTab,
      openPostMenu: (p: ForumPost) => setMenuPost(p),
      castVote: (postId: string, optionIndex: number) => castVoteCore(postId, optionIndex),
    }),
    [t, push, pop, openThread, openProfile, openCommunity, openDm, toast, likeToggle, repostToggle, gotoTab],
  );

  const d = forumData();
  const seeded = d.seeded && d.posts.length > 0;
  // pinnedTags 过滤掉 'hot'（今日热议 = 广场，与「为你推荐」重复，不作为分类标签）
  const pinnedTags = (d.pinnedTags ?? []).filter((id) => id !== 'hot' && COMMUNITY_DEFS.some((c) => c.id === id));
  // 【多世界观 v37】激活世界观（抽屉入口展示用；实时读 store——切换/编辑立即生效）。
  //  世界观话题方向不再作为首页 tab 标签展示（用户要求「狗仔爆料/红毯比美/营销号引战…
  //  混合起来，不要弄成标签」）——话题方向由 engine.worldviewTopics() 洗牌后逐帖注入
  //  生成提示词，自然混在帖子内容里；首页 tab 只留 为你推荐/关注/已添加的分类标签。
  const wvSnap = useSyncExternalStore(subscribeWorldview, worldviewSnapshot);
  const activeWv = wvSnap.worldviews.find((w) => w.id === wvSnap.activeId) ?? null;

  /** 主页 tab 集：为你推荐 | 关注 | 已添加的分类标签（按添加顺序） */
  const homeTabs: { key: string; label: string }[] = useMemo(
    () => [
      { key: 'foryou', label: '为你推荐' },
      { key: 'following', label: '关注' },
      ...pinnedTags.map((id) => ({ key: id, label: communityName(id) })),
    ],
    [pinnedTags],
  );

  // v37：残留的旧世界观标签选中态（wt:xxx）渲染期直接派生回落「为你推荐」
  //（不用 effect——setState-in-effect 会级联重渲，派生值才是 React 推荐写法）
  const effHomeTab = homeTab.startsWith('wt:') ? 'foryou' : homeTab;

  // Feed 数据：为你推荐 = 全部主帖（世界观话题自然混在其中）；关注 = 已关注作者的主帖；
  // 分类标签 tab = 对应版块主帖。过滤：被隐藏（不感兴趣/举报）与未到时间的定时帖不进列表。
  // tick 变化触发重算（定时到期现身）。
  const feedPosts = useMemo(() => {
    const now = Date.now();
    const all = [...d.posts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => p.replyTo === null && isPostVisible(p, now));
    if (effHomeTab === 'following') {
      const followingSet = new Set(d.following);
      return all.filter((p) => followingSet.has(p.authorKey));
    }
    if (effHomeTab !== 'foryou') {
      return all.filter((p) => (p.community ?? 'hot') === effHomeTab);
    }
    return all;
  }, [d, effHomeTab, tick]);

  const unread = d.notifications.filter((n) => !n.read).length;
  const topView = views.length ? views[views.length - 1] : null;

  return (
    <ForumCtx.Provider value={ui}>
      <style>{KEYFRAMES}</style>
      <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: t.bg, color: t.text }}>
        {/* 内容层 */}
        <div className="relative min-h-0 flex-1">
          {/* 主 tab 层（推入页覆盖其上；保持挂载，返回不丢滚动位置） */}
          <div className={views.length ? 'invisible absolute inset-0' : 'absolute inset-0'}>
            {tab === 'home' && (
              /* 主页整页滚动：顶栏+tab 行+信息流一起滚（用户要求：滑动时顶部跟随滑动）；
                 过界手势：滑到底继续上滑松开 → 生成更多（追加下方，旧帖永不消失）；
                 滑到顶继续下拉松开 → 生成新内容（插入最上方） */
              <div
                ref={homeScrollRef}
                data-feed-scroll=""
                onTouchStart={(e) => gestureBegin(e.touches[0]?.clientY ?? 0)}
                onTouchMove={(e) => {
                  const y = e.touches[0]?.clientY;
                  if (typeof y === 'number') gestureMove(y);
                }}
                onTouchEnd={() => gestureEnd(true)}
                onTouchCancel={() => gestureEnd(false)}
                className="forum-hide-scrollbar relative h-full overflow-y-auto overflow-x-hidden overscroll-none"
              >
                {/* 顶部下拉生成指示器（仅 scrollTop=0 下拉时可见；覆盖内容、不拦截点击） */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20" aria-live="polite">
                  <div style={{ paddingTop: 54 }} />
                  <div
                    className="flex items-center justify-center gap-2 overflow-hidden"
                    style={{
                      height: topLoading ? 46 : pullDownPx,
                      opacity: topLoading || pullDownPx > 0 ? 1 : 0,
                      transition: pulling ? 'opacity .15s' : 'height .22s ease, opacity .22s ease',
                    }}
                  >
                    {topLoading ? (
                      <>
                        <span
                          className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                          style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                          aria-hidden="true"
                        />
                        <span className="text-[13px]" style={{ color: t.secondary }}>
                          正在生成新内容…
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="flex transition-transform duration-150"
                          style={{ color: t.secondary, transform: `rotate(${pullDownPx >= VIS_THRESHOLD ? 180 : 0}deg)` }}
                        >
                          <ArrowDown size={16} />
                        </span>
                        <span className="text-[13px]" style={{ color: t.secondary }}>
                          {pullDownPx >= VIS_THRESHOLD ? '松开生成新内容' : '下拉生成新内容'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {/* 手势下拉时内容整体下移让位（loading 期间保持 46px 空隙给指示器）。
                    v8 修复：原先用 transform: translateY 下移内容——transform 会把已吸顶的
                    tab 栏一起往下推（吸顶渲染位置 = 54px + transform 位移），生成期间用户
                    一旦滚动，tab 栏就错位 46px：帖子头露出在 tab 上方、正文被 tab 挡住、
                    顶栏区出现空洞（用户反馈「上滑生成后再下滑顶部缺一块」）。
                    改用 paddingTop：只推移内容自然流位置，吸顶元素的 stuck 偏移仍相对
                    滚动视口（54px）计算，任何滚动位置下 tab 栏都稳定吸顶。 */}
                <div
                  style={{
                    paddingTop: topLoading ? 46 : pullDownPx,
                    transition: pulling ? 'none' : 'padding-top .25s ease',
                  }}
                >
                {/* 顶栏(X:头像 | 𝕏 | 订阅):随内容滚走(用户要求:顶部的头像、X符号、订阅跟随滑动) */}
                <div className="flex items-center justify-between px-4 pt-[54px]" style={{ height: 100, background: t.bg }}>
                  <XAvatar authorKey="user" size={36} onClick={() => setDrawer(true)} />
                  <span aria-hidden="true" style={{ color: t.text }}>
                    <XLogo size={26} />
                  </span>
                  <button
                    type="button"
                    aria-label="订阅"
                    onClick={() => toast('X Premium 订阅暂未开放，敬请期待')}
                    className="flex h-[32px] items-center rounded-full border px-4 text-[13px] font-semibold transition-opacity active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    订阅
                  </button>
                </div>
                {/* tab 行(为你推荐|关注|分类标签… + ＋):吸顶固定在状态栏正下方(用户要求:不跟随滑动);
                    sticky backdrop-blur 半透明(X 吸顶 header 观感) */}
                <div
                  className="sticky top-[54px] z-20 flex items-center border-b"
                  style={{
                    borderColor: t.border,
                    minHeight: 46,
                    background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <div className="forum-hide-scrollbar flex min-w-0 flex-1 flex-wrap items-center">
                    {homeTabs.map(({ key: k, label }) => {
                      const active = effHomeTab === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setHomeTab(k)}
                          className="relative flex h-[46px] shrink-0 items-center px-5 text-[15px]"
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
                  <button
                    type="button"
                    aria-label="添加分类标签"
                    onClick={() => setTagPicker(true)}
                    className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
                    style={{ color: t.secondary }}
                  >
                    {XIcons.plus(22)}
                  </button>
                </div>
                {authorsReady && seeded ? (
                  <FeedList
                    posts={feedPosts}
                    footer={
                      /* 底部过界手势 footer：上拉展开区（达到行程箭头翻转提示「松开」）+ 提示行（可点击，桌面兜底） */
                      <div aria-live="polite">
                        <div
                          className="flex items-center justify-center gap-2 overflow-hidden"
                          style={{
                            height: pullUpPx,
                            opacity: pullUpPx > 0 ? 1 : 0,
                            transition: pulling ? 'none' : 'height .22s ease, opacity .22s ease',
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="flex transition-transform duration-150"
                            style={{ color: t.secondary, transform: `rotate(${pullUpPx >= VIS_THRESHOLD ? 180 : 0}deg)` }}
                          >
                            <ArrowUp size={16} />
                          </span>
                          <span className="text-[13px]" style={{ color: t.secondary }}>
                            {pullUpPx >= VIS_THRESHOLD ? '松开生成更多帖子' : '继续上拉加载更多'}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label="加载更多帖子"
                          onClick={doGenerateMore}
                          className="flex w-full items-center justify-center gap-2 py-6"
                        >
                          {moreLoading ? (
                            <>
                              <span
                                className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                                style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                                aria-hidden="true"
                              />
                              <span className="text-[13px]" style={{ color: t.secondary }}>
                                正在为你生成更多帖子…
                              </span>
                            </>
                          ) : (
                            <span className="text-[13px]" style={{ color: t.secondary }}>
                              上滑加载更多帖子 · X论坛
                            </span>
                          )}
                        </button>
                      </div>
                    }
                  />
                ) : (
                  <FeedSkeleton rows={7} />
                )}
                </div>
              </div>
            )}
            {/* v7 状态栏衬底（仅主页）：主页顶栏随内容滚走后，信息流会直接滑到
                状态栏正后方——时间/信号/电量后面不再是生内容（用户反馈「状态栏
                后面有点问题」）。z-[15] 盖住滚动内容，低于吸顶 tab 行(z-20)、
                推入页层(z-30)与系统状态栏(z-70)；在顶栏未滚走时叠在纯色顶栏上
                无视觉变化，滚走后与吸顶 tab 行同材质（模糊半透明）无缝衔接 */}
            {tab === 'home' && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-[15] h-[54px]"
                style={{
                  background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              />
            )}
            {tab === 'search' && <SearchView />}
            {tab === 'communities' && <CommunitiesView />}
            {tab === 'notifications' && <NotificationsView />}
            {tab === 'dms' && <DmsView />}
          </div>

          {/* 推入页层（右滑入覆盖，整页含各自顶栏；底栏保留在下方） */}
          {topView && (
            <div
              key={views.length}
              className="absolute inset-0 z-30 animate-[forum-in_.26s_ease-out]"
              style={{ background: t.bg, overflowY: 'auto', overflowX: 'hidden' }}
            >
              {topView.kind === 'thread' && <ThreadView postId={topView.postId} />}
              {topView.kind === 'profile' && <ProfileView authorKey={topView.key} />}
              {topView.kind === 'community' && <CommunityPage id={topView.id} />}
              {topView.kind === 'dm' && <DmThread peerKey={topView.peerKey} />}
            </div>
          )}

          {/* 发布 FAB（X：右下蓝圆 + 白编辑笔；所有主 tab 页都显示） */}
          {views.length === 0 && (
            <button
              type="button"
              aria-label="发布帖子"
              onClick={() => setCompose(true)}
              className="absolute bottom-4 right-4 z-40 flex h-[56px] w-[56px] items-center justify-center rounded-full text-white shadow-[0_4px_16px_rgba(0,0,0,0.25)] transition-transform active:scale-90"
              style={{ background: t.blue }}
            >
              {XIcons.compose(26)}
            </button>
          )}
        </div>

        {/* 底部 5 tab（X：纯图标无标签，选中黑实心/深色模式白，未选灰） */}
        <nav
          aria-label="论坛主导航"
          className="flex shrink-0 items-stretch justify-around border-t pb-[16px]"
          style={{ borderColor: t.border, background: t.bg }}
        >
          {TABS.map((k) => {
            const active = tab === k && views.length === 0;
            // X 官方底栏：选中 = 正文色实心（浅色黑/深色白），未选 = 灰
            const color = active ? t.text : t.secondary;
            const icon =
              k === 'home' ? (
                XIcons.home(active)
              ) : k === 'search' ? (
                XIcons.search()
              ) : k === 'communities' ? (
                XIcons.spaces(active, 25, t.bg)
              ) : k === 'notifications' ? (
                XIcons.bell(active)
              ) : (
                XIcons.mail(active)
              );
            return (
              <button
                key={k}
                type="button"
                aria-label={
                  k === 'home'
                    ? '主页'
                    : k === 'search'
                      ? '搜索'
                      : k === 'communities'
                        ? '社区'
                        : k === 'notifications'
                          ? `通知${unread ? `（${unread} 条未读）` : ''}`
                          : '私信'
                }
                onClick={() => {
                  setViews([]);
                  setTabRaw(k);
                }}
                className="relative flex w-full items-center justify-center"
                style={{ color, height: 46 }}
              >
                {icon}
                {k === 'notifications' && unread > 0 && !active && (
                  <span
                    className="absolute left-[calc(50%+15px)] top-[7px] h-[8px] w-[8px] rounded-full"
                    style={{ background: t.blue, boxShadow: `0 0 0 2px ${t.bg}` }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* 侧边抽屉（X 侧滑菜单） */}
        {drawer && (
          <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="论坛菜单">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute inset-0 animate-[forum-fade_.2s_ease-out]"
              style={{ background: 'rgba(0,0,0,0.45)' }}
              onClick={() => setDrawer(false)}
            />
            <div
              className="absolute inset-y-0 left-0 w-[78%] max-w-[320px] animate-[forum-drawer_.24s_ease-out] overflow-y-auto overflow-x-hidden"
              style={{ background: t.bg, color: t.text }}
            >
              <div className="px-5 pt-[64px]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-[22px] font-extrabold" style={{ color: t.text }}>
                    X论坛
                  </span>
                  <span style={{ color: t.text }}>
                    <XLogo size={22} />
                  </span>
                </div>
                {/* 个人摘要（点头像进主页） */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawer(false);
                    openProfile('user');
                  }}
                  className="mt-2 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:opacity-70"
                  style={{ background: t.hover }}
                >
                  <XAvatar authorKey="user" size={44} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold">{resolveAuthor('user').name}</span>
                    <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                      @{resolveAuthor('user').handle}
                    </span>
                    <span className="mt-[2px] block text-[13px]" style={{ color: t.secondary }}>
                      <span style={{ color: t.text, fontWeight: 700 }}>{myFollowingCount(d)}</span> 关注 ·{' '}
                      <span style={{ color: t.text, fontWeight: 700 }}>{followersOf('user')}</span> 粉丝
                    </span>
                  </div>
                </button>
                {/* 菜单 */}
                <div className="mt-4 border-t pt-3" style={{ borderColor: t.border }}>
                  {/* v33【AI 真人社交】活跃度开关：门控角色主动发帖/逛帖/互动（神回复不受限） */}
                  <div className="mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-[10px]">
                    <div className="flex min-w-0 flex-col gap-[1px] text-left">
                      <span className="text-[15px] font-medium">AI 活跃度</span>
                      <span className="text-[12px] leading-snug" style={{ color: t.secondary }}>
                        角色像真人一样发帖、点赞、评论（有分钟级延迟）；关闭后不再主动，但仍会回复你
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiActivity}
                      aria-label="切换 AI 活跃度"
                      onClick={() => {
                        const next = !aiActivity;
                        setForumAiActivity(next);
                        toast(
                          next
                            ? 'AI 活跃度已开启：角色将像真人一样逛论坛'
                            : 'AI 活跃度已关闭：角色不再主动发帖与互动',
                        );
                      }}
                      className="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors"
                      style={{
                        background: aiActivity ? '#34c759' : 'rgba(120,120,128,0.32)',
                        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.06)',
                      }}
                    >
                      <span
                        className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-all duration-200"
                        style={{ left: aiActivity ? 22 : 2 }}
                      />
                    </button>
                  </div>

                  {/* v34 生成设置：每次生成帖子/评论条数范围（X~Y 条）+ 提示词管理入口 */}
                  <div className="mb-2 border-t pt-2" style={{ borderColor: t.border }}>
                    <div className="px-3 pb-[6px] text-[12px] font-bold tracking-wide" style={{ color: t.secondary }}>
                      生成设置
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <GenRangeRow
                        label="每次生成帖子"
                        hint="主页下拉/上拉刷新一次生成的帖子条数"
                        min={genUi.pMin}
                        max={genUi.pMax}
                        bounds={POST_COUNT_BOUNDS}
                        onBump={(which, d) => bumpGenRange('posts', which, d)}
                      />
                      <GenRangeRow
                        label="每次生成评论"
                        hint="点「显示更多评论」一次补的评论条数"
                        min={genUi.cMin}
                        max={genUi.cMax}
                        bounds={COMMENT_COUNT_BOUNDS}
                        onBump={(which, d) => bumpGenRange('comments', which, d)}
                      />
                      {/* 提示词管理：全部生成提示词查看/编辑，改完立即生效 */}
                      <button
                        type="button"
                        onClick={() => setPromptSheet(true)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-70"
                        style={{ background: t.hover }}
                        aria-label="打开提示词管理面板"
                      >
                        <div className="flex min-w-0 flex-col gap-[1px]">
                          <span className="text-[15px] font-medium">提示词</span>
                          <span className="text-[12px] leading-snug" style={{ color: t.secondary }}>
                            全部 {FORUM_PROMPT_DEFS.length} 条生成提示词
                            {ovCount > 0 ? ` · ${ovCount} 条已自定义` : ' · 可查看与修改'}
                          </span>
                        </div>
                        <span aria-hidden="true" className="shrink-0 text-[15px]" style={{ color: t.secondary }}>
                          ›
                        </span>
                      </button>
                    </div>
                  </div>
                  {/* v36【多世界观】世界观与规则：切换世界观 / 管理 NPC 矩阵 / 修改 AI 规则 */}
                  <div className="mb-2 border-t pt-2" style={{ borderColor: t.border }}>
                    <div className="px-3 pb-[6px] text-[12px] font-bold tracking-wide" style={{ color: t.secondary }}>
                      世界观与规则
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <button
                        type="button"
                        onClick={() => setWorldSheet(true)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-70"
                        style={{ background: t.hover }}
                        aria-label="打开世界观面板"
                      >
                        <div className="flex min-w-0 flex-col gap-[1px]">
                          <span className="text-[15px] font-medium">切换世界观</span>
                          {activeWv ? (
                            <span className="flex min-w-0 items-center gap-[5px] text-[12px] leading-snug" style={{ color: t.secondary }}>
                              <WorldviewIcon id={activeWv.id} emoji={activeWv.emoji} size={16} />
                              <span className="truncate">
                                {activeWv.name} · {wvSnap.worldviews.length} 个可选
                              </span>
                            </span>
                          ) : (
                            <span className="truncate text-[12px] leading-snug" style={{ color: t.secondary }}>
                              选择论坛的世界设定
                            </span>
                          )}
                        </div>
                        <span aria-hidden="true" className="shrink-0 text-[15px]" style={{ color: t.secondary }}>
                          ›
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNpcSheet(true)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-70"
                        style={{ background: t.hover }}
                        aria-label="打开 NPC 矩阵管理面板"
                      >
                        <div className="flex min-w-0 flex-col gap-[1px]">
                          <span className="text-[15px] font-medium">管理 NPC 矩阵</span>
                          <span className="truncate text-[12px] leading-snug" style={{ color: t.secondary }}>
                            {activeWv ? `${activeWv.matrix.length} 位核心 NPC · 瓜主/营销号/站姐/杠精` : '身份、性格、口头禅、发帖频率'}
                          </span>
                        </div>
                        <span aria-hidden="true" className="shrink-0 text-[15px]" style={{ color: t.secondary }}>
                          ›
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRulesSheet(true)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-70"
                        style={{ background: t.hover }}
                        aria-label="打开 AI 规则编辑面板"
                      >
                        <div className="flex min-w-0 flex-col gap-[1px]">
                          <span className="text-[15px] font-medium">修改 AI 规则</span>
                          <span className="truncate text-[12px] leading-snug" style={{ color: t.secondary }}>
                            发帖 / 评论 / 审核过滤{rulesCount > 0 ? ` · ${rulesCount} 条已自定义` : ' · 拼在提示词最前端'}
                          </span>
                        </div>
                        <span aria-hidden="true" className="shrink-0 text-[15px]" style={{ color: t.secondary }}>
                          ›
                        </span>
                      </button>
                    </div>
                  </div>

                  {[
                    {
                      label: '个人资料',
                      hint: '主页与帖子',
                      onClick: () => {
                        setDrawer(false);
                        openProfile('user');
                      },
                    },
                    {
                      label: '去社区逛逛',
                      hint: '版块与广场',
                      onClick: () => {
                        setDrawer(false);
                        gotoTab(2);
                      },
                    },
                    {
                      label: '重置论坛数据',
                      hint: '清空帖子/通知/私信并重新开张',
                      onClick: () => {
                        setDrawer(false);
                        saveForum({
                          ...forumData(),
                          posts: [],
                          notifications: [],
                          dms: [],
                          following: [],
                          likesByMe: {},
                          seeded: false,
                          lastGenAt: 0,
                        });
                        void bootForum();
                        toast('论坛已重置，正在重新开张');
                      },
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className="flex w-full flex-col gap-[1px] rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    >
                      <span className="text-[15px] font-medium">{item.label}</span>
                      <span className="text-[12px]" style={{ color: t.secondary }}>
                        {item.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 发布弹层 */}
        {compose && <ComposeSheet onClose={() => setCompose(false)} onPublish={publish} />}

        {/* v34 提示词管理面板（抽屉「提示词」入口打开；覆盖抽屉层） */}
        {promptSheet && (
          <PromptSheet
            toast={toast}
            onClose={() => {
              setPromptSheet(false);
              setOvCount(countPromptOverrides());
              // 范围值同步刷新（面板不动范围，保险起见仍读一次）
              const s = getForumGenSettings();
              setGenUi({ pMin: s.postCountMin, pMax: s.postCountMax, cMin: s.commentCountMin, cMax: s.commentCountMax });
            }}
          />
        )}

        {/* v36【多世界观】三个管理面板（抽屉入口打开；覆盖抽屉层） */}
        {worldSheet && <WorldviewSheet toast={toast} onClose={() => setWorldSheet(false)} />}
        {npcSheet && (
          <NpcMatrixSheet
            toast={toast}
            onClose={() => {
              setNpcSheet(false);
              setRulesCount(countCustomRules());
            }}
          />
        )}
        {rulesSheet && (
          <RulesSheet
            toast={toast}
            onClose={() => {
              setRulesSheet(false);
              setRulesCount(countCustomRules());
            }}
          />
        )}

        {/* 帖子「···」底部菜单（X iOS 风格：摘要 + 推荐/不感兴趣/举报） */}
        {menuPost && (
          <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="帖子更多操作">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
              style={{ background: 'rgba(0,0,0,0.45)' }}
              onClick={() => setMenuPost(null)}
            />
            <div
              className="absolute inset-x-0 bottom-0 animate-[forum-sheet_.24s_ease-out] rounded-t-2xl pb-[20px]"
              style={{ background: t.bg, color: t.text }}
            >
              {/* grabber */}
              <div className="flex justify-center pt-2" aria-hidden="true">
                <span className="h-[5px] w-9 rounded-full" style={{ background: t.dark ? '#2f3336' : '#eff3f4' }} />
              </div>
              {/* 帖子摘要（X 官方菜单顶部预览） */}
              <div className="flex gap-3 border-b px-5 pb-3 pt-3" style={{ borderColor: t.border }}>
                <XAvatar authorKey={menuPost.authorKey} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold" style={{ color: t.text }}>
                    {resolveAuthor(menuPost.authorKey).name}
                    <span className="ml-1 font-normal" style={{ color: t.secondary }}>
                      @{resolveAuthor(menuPost.authorKey).handle}
                    </span>
                  </p>
                  <p className="mt-[2px] line-clamp-2 text-[14px] leading-snug" style={{ color: t.secondary }}>
                    {menuPost.content}
                  </p>
                </div>
              </div>
              {/* 菜单项（用户需求：推荐最上 / 不感兴趣→帖子消失 / 举报→帖子消失） */}
              {(
                [
                  {
                    icon: <Sparkles width={21} height={21} strokeWidth={1.9} />,
                    label: '推荐',
                    desc: '为你推荐更多同类帖子',
                    color: t.text,
                    onClick: () => {
                      setMenuPost(null);
                      toast('已为你推荐更多同类帖子');
                    },
                  },
                  {
                    icon: <EyeOff width={21} height={21} strokeWidth={1.9} />,
                    label: '不感兴趣',
                    desc: '之后会少推荐这类帖子',
                    color: t.text,
                    onClick: () => {
                      hidePost(menuPost.id);
                      setMenuPost(null);
                      toast('已记录，之后会少推荐这类帖子');
                    },
                  },
                  {
                    icon: <Flag width={21} height={21} strokeWidth={1.9} />,
                    label: '举报',
                    desc: '该帖子将不再展示给你',
                    color: '#f4212e',
                    onClick: () => {
                      hidePost(menuPost.id);
                      setMenuPost(null);
                      toast('已收到举报，该帖子不会再展示给你');
                    },
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  className="flex w-full items-center gap-3 px-5 py-[14px] text-left transition-colors active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className="shrink-0" style={{ color: item.color }} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold" style={{ color: item.color }}>
                      {item.label}
                    </span>
                    <span className="block text-[13px]" style={{ color: t.secondary }}>
                      {item.desc}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 添加分类标签弹层（+ 号：勾选版块作为主页附加 tab） */}
        {tagPicker && (
          <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="添加分类标签">
            <button
              type="button"
              aria-label="关闭"
              className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
              style={{ background: 'rgba(0,0,0,0.4)' }}
              onClick={() => setTagPicker(false)}
            />
            <div
              className="forum-hide-scrollbar absolute inset-x-0 bottom-0 max-h-[72%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto overflow-x-hidden rounded-t-2xl pb-[24px]"
              style={{ background: t.bg, color: t.text }}
            >
              <div className="sticky top-0 z-10 pb-1 pt-4" style={{ background: t.bg }}>
                <p className="px-5 text-[17px] font-bold">添加分类标签</p>
                <p className="mt-1 px-5 text-[13px] leading-relaxed" style={{ color: t.secondary }}>
                  勾选的版块会作为标签显示在主页顶部，点击标签即可只看该版块的帖子
                </p>
                <div className="mx-5 mt-3 border-t" style={{ borderColor: t.border }} />
              </div>
              {/* 「今日热议」= 广场（与为你推荐重复），已按用户要求从标签列表移除 */}
              {COMMUNITY_DEFS.filter((c) => c.id !== 'hot').map((c) => {
                const on = pinnedTags.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleTag(c.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:opacity-60"
                    style={{ background: on ? t.hover : 'transparent' }}
                    aria-pressed={on}
                  >
                    <CommunityIcon id={c.id} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{c.name}</span>
                      <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                        {countShort(c.members)} 成员 · {c.desc}
                      </span>
                    </span>
                    <span
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                      style={
                        on
                          ? { background: t.blue, color: '#fff' }
                          : { border: `2px solid ${t.dark ? '#536471' : '#cfd9de'}` }
                      }
                      aria-hidden="true"
                    >
                      {on && <Check width={14} height={14} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
              <p className="px-5 pb-1 pt-3 text-center text-[12px]" style={{ color: t.secondary }}>
                再次点击已勾选的版块可移除标签
              </p>
            </div>
          </div>
        )}

        {/* 底部 toast（X 深色胶囊） */}
        {toastMsg && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 bottom-[86px] z-[60] mx-auto w-fit max-w-[80%] animate-[forum-fade_.18s_ease-out] rounded-full px-4 py-2 text-[14px] text-white shadow-lg"
            style={{ background: 'rgba(0,0,0,0.82)' }}
          >
            {toastMsg.text}
          </div>
        )}
      </div>
    </ForumCtx.Provider>
  );
}
