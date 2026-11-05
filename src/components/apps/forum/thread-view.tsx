'use client';

/**
 * X论坛 · 帖子详情页（X thread，评论流按用户参考图 1:1 精修）。
 * 顶栏：返回 + 「帖子」；主帖 48px 头像 / 名行右侧「关注」黑胶囊；
 * 官方元数据行「H:mm · 年月日 · N 次浏览」+ 蓝色「翻译」按钮
 * （X 官方行为：译文原位替换正文展示，下方标注「由 AI 翻译」，
 * 按钮可在 查看原文/查看译文 间切换）；
 * 互动栏（回复/转推/点赞/浏览/分享，爱心归位第三，带数字）+ 分隔线下接评论流；
 * 打开帖子不自动生成评论（用户要求：仅「显示更多评论」按钮触发，7~15 条）；
 * 评论流按参考图：头像 + 名字(bold) + @账号 · 时间(灰) + 右侧「···」，
 * v24 楼中楼头像对齐：所有层级子回复头像统一 28px、排同一垂直列（与上面的评论
 * 头像对齐，不再楼梯式逐层缩进/缩小）；嵌套回复正文强制带「回复 @被回复者：」
 * 前缀（动态取父帖作者当前昵称，NPC 被 LLM 改名也不会@错人）；
 * 一级评论正文绝不带任何@前缀字样；
 * 操作行为空心线性图标（回复/转推/爱心/浏览/分享，图标+数字）；
 * 头像右缘细竖线贯穿到子回复；
 * 底部回复输入条（头像 + input + 蓝色发送圆钮），
 * 点击评论/任意层子回复即定向回复（显示「回复 @xx」提示条，可取消）；
 * 用户回复 AI 评论 → AI 感觉主帖内容+用户评论内容再回一条，无限多轮（engine）。
 */

import { useRef, useState, useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import {
  activeAuthorKey,
  childRepliesOf,
  countShort,
  descendantCountOf,
  forumData,
  forumSnapshot,
  isUserAuthor,
  likesOf,
  relTime,
  resolveAuthor,
  saveForum,
  stripImgPh,
  subscribeForum,
  uid,
  REPLY_MAX,
  type ForumData,
  type ForumPost,
} from '@/lib/forum/core';
import { generateMoreComments, queueAiReplyToUserReply } from '@/lib/forum/engine';
import { writeUserCommentMemory } from '@/lib/forum/social';
import { detectMessageLang, requestTranslation } from '@/lib/chat-translate';
import { useSettings } from '@/lib/ios/store';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostBodyMedia, PollBlock, LocationLine } from './feed';

/** 论坛翻译请求 + 超时保护 + 限流自动重试。
 *  服务端单轮预算 ~2 分钟（高优会话锁：重试期间后台生成暂停、配额恢复）；
 *  失败若为限流（服务端带 rateLimited 标记）则 15s 后自动再试一轮，最多 2 轮——
 *  生成高峰期点翻译不再「一下就报失败」，而是排队等配额恢复自动出结果。
 *  总超时 280s（正常情况几秒~几十秒即出）。 */
function translateForum(text: string): Promise<string> {
  const target = detectMessageLang(text) === 'zh-Hans' ? 'en' : 'zh-Hans';
  const attempt = () =>
    requestTranslation({ text, lang: target, apiConfig: useSettings.getState().apiConfig });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('翻译超时，请稍后再试')), 280_000);
    const run = (round: number) => {
      attempt()
        .then((out) => {
          clearTimeout(timer);
          resolve(out);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          const limited = /429|too many|rate.?limit|限流/i.test(msg);
          // 限流失败：自动再试一轮（服务端会话锁重试 + 客户端补轮，胜率大幅提升）
          if (limited && round < 2) {
            setTimeout(() => run(round + 1), 15_000);
            return;
          }
          clearTimeout(timer);
          reject(err);
        });
    };
    run(1);
  });
}

/** 翻译失败提示（区分限流与其他错误）：限流 = AI 配额被生成任务占用，
 *  稍等即恢复；其他 = 配置/网络问题。 */
function translateFailToast(err: unknown, toast: (s: string) => void): void {
  const msg = err instanceof Error ? err.message : String(err);
  const limited = /429|too many|rate.?limit|限流/i.test(msg);
  toast(limited ? 'AI 配额限流中，稍等一会再点翻译' : '翻译失败，稍后再试');
}

/** 评论翻译（用户要求：评论区的翻译按钮放在最右面）。
 *  状态钩：按钮挂在操作行最右，译文附加显示在原文之后（不替换原文），
 *  可在 查看译文/收起译文 间切换；外语评论 → 简体中文，简体中文评论 → 英语。 */
function useCommentTr(text: string) {
  const f = useForum();
  const [st, setSt] = useState<{ loading: boolean; out: string | null; shown: boolean }>({
    loading: false,
    out: null,
    shown: false,
  });
  const toggle = () => {
    if (st.loading) return;
    // 已有译文：切换展示/收起
    if (st.out !== null) {
      setSt((s) => ({ ...s, shown: !s.shown }));
      return;
    }
    const src = text.trim();
    if (!src) return;
    setSt({ loading: true, out: null, shown: false });
    translateForum(src)
      .then((out) => setSt({ loading: false, out, shown: true }))
      .catch((err) => {
        setSt({ loading: false, out: null, shown: false });
        translateFailToast(err, f.toast);
      });
  };
  return { st, toggle };
}

/** 译文展示行：附加在原文之后（不替换原文）+「由 AI 翻译」标注 */
function TranslatedTextLine({ out }: { out: string }) {
  const f = useForum();
  const t = f.t;
  return (
    <p className="mt-[3px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]" style={{ color: t.text }}>
      {out}
      <span className="ml-1.5 inline-flex items-center gap-1 text-[12px] font-normal" style={{ color: t.secondary }}>
        <Languages width={11} height={11} strokeWidth={1.9} aria-hidden="true" />
        由 AI 翻译
      </span>
    </p>
  );
}

/** 详情页互动栏单个图标钮（X 官方：带数字，悬停浅色圆底 + 图标/数字同步变色） */
function ThreadAction({
  icon,
  count,
  color,
  hoverColor,
  hoverBg,
  onClick,
  label,
  size = 'md',
}: {
  icon: React.ReactNode;
  count?: number;
  color: string;
  hoverColor: string;
  hoverBg: string;
  onClick?: () => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex items-center gap-[3px] rounded-full transition-colors active:opacity-60 ${
        size === 'sm' ? 'p-[4px]' : 'p-[6px]'
      }`}
      style={{ color }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor;
        e.currentTarget.style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = color;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className={`pr-[3px] leading-none ${size === 'sm' ? 'text-[12px]' : 'text-[14px]'}`}>
          {countShort(count)}
        </span>
      )}
    </button>
  );
}

/** 评论操作行（参考图规格）：回复/转推/爱心/浏览/分享 + 最右「翻译」
 *  （用户要求：评论区书签已删除；翻译按钮放在最右面；爱心激活粉色实心、转推激活绿色），
 *  图标+数字，悬停浅色圆底。translate 传入时在行末渲染翻译按钮。 */
function CommentActions({
  post,
  subCount,
  compact,
  onReplyClick,
  translate,
}: {
  post: ForumPost;
  subCount: number;
  compact?: boolean;
  onReplyClick: () => void;
  translate?: { loading: boolean; active: boolean; onClick: () => void };
}) {
  const f = useForum();
  const t = f.t;
  const liked = post.likes.includes(activeAuthorKey());
  const reposted = post.reposted === true;
  const iconSize = compact ? 15 : 16;
  const size = compact ? 'sm' : 'md';
  return (
    <div
      className={`mt-1.5 flex items-center ${compact ? 'gap-[2px]' : 'justify-between'}`}
      style={{ maxWidth: compact ? 400 : 470 }}
    >
      <ThreadAction
        icon={XIcons.reply(iconSize)}
        count={subCount}
        label="回复"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={onReplyClick}
      />
      <ThreadAction
        icon={XIcons.repost(iconSize)}
        count={post.reposts}
        label={reposted ? '撤销转推' : '转推'}
        size={size}
        color={reposted ? t.green : t.secondary}
        hoverColor={t.green}
        hoverBg="rgba(0,186,124,0.12)"
        onClick={() => f.repostToggle(post.id)}
      />
      <ThreadAction
        icon={XIcons.like(liked, iconSize)}
        count={likesOf(post)}
        label={liked ? '取消点赞' : '点赞'}
        size={size}
        color={liked ? t.pink : t.secondary}
        hoverColor={t.pink}
        hoverBg="rgba(249,24,128,0.12)"
        onClick={() => f.likeToggle(post.id)}
      />
      <ThreadAction
        icon={XIcons.views(iconSize)}
        count={post.views}
        label="浏览量"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={() => f.toast(`这条回复已有 ${countShort(post.views)} 次浏览`)}
      />
      <ThreadAction
        icon={XIcons.share(iconSize)}
        label="分享"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={() => f.sharePost(post)}
      />
      {/* 翻译按钮：操作行最右面（用户要求）；已有译文时高亮，点击展开/收起 */}
      {translate && (
        <ThreadAction
          icon={
            translate.loading ? (
              <span
                className="inline-block h-[13px] w-[13px] animate-spin rounded-full border-[1.8px]"
                style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }}
                aria-hidden="true"
              />
            ) : (
              <Languages width={iconSize} height={iconSize} strokeWidth={1.9} />
            )
          }
          label={translate.active ? '收起译文' : '翻译'}
          size={size}
          color={translate.active ? t.blue : t.secondary}
          hoverColor={t.blue}
          hoverBg="rgba(29,155,240,0.12)"
          onClick={translate.onClick}
        />
      )}
    </div>
  );
}

/** 评论名行（参考图规格）：名字(bold 黑) + 认证 + @账号 · 时间(灰) + 最右「···」 */
function CommentNameRow({
  authorKey,
  createdAt,
  onMore,
  nameMax,
  op,
}: {
  authorKey: string;
  createdAt: number;
  onMore: () => void;
  nameMax: number;
  /** v46【楼主回复】：主帖作者的评论/回复带「楼主」徽章（X 的 Author 标识） */
  op?: boolean;
}) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(authorKey);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => f.openProfile(authorKey)}
        className="shrink truncate text-[15px] font-bold"
        style={{ color: t.text, maxWidth: nameMax }}
      >
        {a.name}
      </button>
      {a.verified && <VerifiedBadge size={14} />}
      {op && (
        <span
          className="shrink-0 rounded-[4px] px-[5px] py-[1px] text-[10px] font-medium leading-[14px]"
          style={{ background: 'rgba(120,120,128,0.18)', color: t.secondary }}
        >
          楼主
        </span>
      )}
      <span className="truncate text-[14px]" style={{ color: t.secondary }}>
        @{a.handle} · {relTime(createdAt)}
      </span>
      <button
        type="button"
        aria-label="更多"
        onClick={(e) => {
          e.stopPropagation();
          onMore();
        }}
        className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
        style={{ color: t.secondary }}
      >
        {XIcons.more(18)}
      </button>
    </div>
  );
}

/** 子回复树节点（v24 头像对齐重排：拆掉楼梯）。
 *  · 数据：parentId = replyToPost（旧数据回退 replyTo）；直接回复主帖 → 挂在主帖下（一级）；
 *  · 渲染（用户要求：回复头像和上面的评论头像对齐，不要跟楼梯一样）：
 *    所有层级的楼中楼头像同一尺寸（28px）、排成同一垂直列——子回复容器与本层平级
 *    （不再嵌在本层内容列里逐层缩进、头像不再随深度缩小）；层级关系由
 *    「回复 @被回复者：」前缀 + 头像右缘竖线表达（X 官方嵌套对话流的做法）；
 *  · 交互：点任意层回复 → 定向回复那一条；stopPropagation 阻断冒泡到上层
 *    （旧版冒泡会把点击目标错位成最外层——点到谁就回复谁）。 */
function SubReplyItem({
  s,
  rootId,
  parentName,
  onReply,
  opAuthorKey,
}: {
  s: ForumPost;
  rootId: string;
  /** 被回复者显示名（父帖作者当前昵称，动态解析） */
  parentName: string;
  onReply: (rootId: string, postId: string, name: string) => void;
  /** v46【楼主回复】：主帖作者 key（TA 的回复带「楼主」徽章） */
  opAuthorKey?: string;
}) {
  const f = useForum();
  const t = f.t;
  const sa = resolveAuthor(s.authorKey);
  const d = forumData();
  const sSubs = childRepliesOf(d, s.id);
  const avSize = 28; // v24：所有楼中楼头像统一 28px（不再随深度缩小）
  const tr = useCommentTr(s.content);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`回复 ${sa.name} 的评论`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.stopPropagation(); // v24：阻断冒泡——点到谁就定向回复谁，不被上层覆盖
        onReply(rootId, s.id, sa.name); // 点任意层 → 定向回复那一条（挂 TA 名下，AI 接话也定位到 TA）
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onReply(rootId, s.id, sa.name);
        }
      }}
      className="cursor-pointer rounded-lg py-2 transition-colors active:opacity-60"
    >
      <div className="flex gap-2">
        {/* 头像列：v24 头像对齐（与上层评论同一列）+ 右缘细竖线贯穿到自己的子回复 */}
        <div className="flex shrink-0 flex-col items-center">
          <XAvatar authorKey={s.authorKey} size={avSize} onClick={() => f.openProfile(s.authorKey)} />
          {sSubs.length > 0 && (
            <span className="mt-1 w-[2px] flex-1" style={{ background: t.border }} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* 名行：名字(bold) + @账号 · 时间(灰) + 最右「···」 */}
          <CommentNameRow
            authorKey={s.authorKey}
            createdAt={s.createdAt}
            onMore={() => f.openPostMenu(s)}
            nameMax={90}
            op={!!opAuthorKey && s.authorKey === opAuthorKey}
          />
          {/* 子回复正文：强制带「回复 @被回复者：」前缀（动态取父帖作者名，永不错位） */}
          <p
            className="mt-[1px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]"
            style={{ color: t.text }}
          >
            <span style={{ color: t.secondary }}>回复 </span>
            <span style={{ color: t.blue }}>@{parentName}</span>
            <span style={{ color: t.secondary }}>：</span>
            {s.content}
          </p>
          {/* 译文（附加在原文之后；按钮在下方操作行最右） */}
          {tr.st.out !== null && tr.st.shown && <TranslatedTextLine out={tr.st.out} />}
          {/* 小操作行（回复/转推/爱心/浏览/分享 + 最右翻译，小一号） */}
          <CommentActions
            post={s}
            subCount={descendantCountOf(d, s.id)}
            compact
            onReplyClick={() => onReply(rootId, s.id, sa.name)}
            translate={{ loading: tr.st.loading, active: tr.st.shown, onClick: tr.toggle }}
          />
        </div>
      </div>
      {/* v24 头像对齐：子回复容器与本层平级（不嵌在本层内容列里）——所有楼中楼
          头像排成同一垂直列、与上面的评论头像对齐，不再楼梯式缩进 */}
      {sSubs.length > 0 && (
        <div className="mt-1 flex flex-col">
          {sSubs.map((c) => (
            <SubReplyItem key={c.id} s={c} rootId={rootId} parentName={sa.name} onReply={onReply} opAuthorKey={opAuthorKey} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 顶层评论（参考图规格）：头像 44px + 头像右缘竖线贯穿到子回复 +
 *  名行（名字bold + @账号·时间灰 + 右侧···）+ 正文 + 图标操作行（最右翻译）；
 *  v24 楼中楼头像对齐：子回复统一 28px 排同一垂直列（带「回复 @xx：」前缀），
 *  不再逐层缩进/缩小；点评论/子回复 → 定向回复（stopPropagation，支持无限多轮）。 */
function CommentRow({
  comment,
  onReply,
  opAuthorKey,
}: {
  comment: ForumPost;
  onReply: (rootId: string, postId: string, name: string) => void;
  /** v46【楼主回复】：主帖作者 key（楼主本人的评论/回复带「楼主」徽章） */
  opAuthorKey?: string;
}) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(comment.authorKey);
  // 直算不 memo：论坛数据对象会被引擎原位变更（saveForum 浅拷贝外壳、posts 原数组），
  // useMemo 依赖 [comment.id] 在新增子回复时不会重算 → 子回复列表滞留旧值（同 profile-view 的教训）。
  const d = forumData();
  const subReplies = childRepliesOf(d, comment.id);
  const subTotal = descendantCountOf(d, comment.id);
  const tr = useCommentTr(comment.content);

  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: t.border }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onReply(comment.id, comment.id, a.name); // X 行为：点评论即定向回复
      }}
    >
      <div className="flex gap-2.5">
        {/* 头像列：44px 头像 + 右缘细竖线贯穿到子回复（X 官方嵌套对话流连接线） */}
        <div className="flex shrink-0 flex-col items-center">
          <XAvatar authorKey={comment.authorKey} size={44} onClick={() => f.openProfile(comment.authorKey)} />
          {subReplies.length > 0 && (
            <span className="mt-1 w-[2px] flex-1" style={{ background: t.border }} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* 名行：名字(bold) + @账号 · 时间(灰) + 最右「···」 */}
          <CommentNameRow
            authorKey={comment.authorKey}
            createdAt={comment.createdAt}
            onMore={() => f.openPostMenu(comment)}
            nameMax={110}
            op={!!opAuthorKey && comment.authorKey === opAuthorKey}
          />
          {/* 评论正文 */}
          <p className="mt-[2px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]" style={{ color: t.text }}>
            {comment.content}
          </p>
          {/* 译文（附加在原文之后；翻译按钮在下方操作行最右面） */}
          {tr.st.out !== null && tr.st.shown && <TranslatedTextLine out={tr.st.out} />}
          {/* 操作行：回复/转推/爱心/浏览/分享 + 最右翻译 */}
          <CommentActions
            post={comment}
            subCount={subTotal}
            onReplyClick={() => onReply(comment.id, comment.id, a.name)}
            translate={{ loading: tr.st.loading, active: tr.st.shown, onClick: tr.toggle }}
          />
          {/* 楼中楼（v24 头像对齐）：所有子回复头像同一列对齐 + 「回复 @被回复者：」前缀 */}
          {subReplies.length > 0 && (
            <div className="mt-2 flex flex-col">
              {subReplies.map((s) => (
                <SubReplyItem
                  key={s.id}
                  s={s}
                  rootId={comment.id}
                  parentName={a.name}
                  onReply={onReply}
                  opAuthorKey={opAuthorKey}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 帖子详情页一级评论（v7 树语义）：直接回复主帖的（parentId = 主帖 id）；
 *  父对象丢失的孤儿回复（分组锚点指向本帖但按 parentId 挂不到树上的，如被回复的
 *  评论已被删）兜底挂回一级——任何情况下评论都不丢、不凭空消失。 */
function threadFirstLevel(d: ForumData, postId: string): ForumPost[] {
  const first = childRepliesOf(d, postId);
  // 可达集：一级评论的全部子孙（沿真实 parentId 走）
  const reach = new Set<string>(first.map((p) => p.id));
  const walk = (id: string, depth: number) => {
    if (depth > 8) return; // 防环
    for (const c of childRepliesOf(d, id)) {
      if (!reach.has(c.id)) {
        reach.add(c.id);
        walk(c.id, depth + 1);
      }
    }
  };
  first.forEach((p) => walk(p.id, 0));
  // 孤儿：锚点指向本帖但树挂不上 → 兜底视为一级
  const orphans = d.posts.filter((p) => p.id !== postId && p.replyTo === postId && !reach.has(p.id));
  return [...first, ...orphans].sort((x, y) => x.createdAt - y.createdAt);
}

export function ThreadView({ postId }: { postId: string }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const post = d.posts.find((p) => p.id === postId);
  /** 一级评论（直接回复主帖）——v7 树语义：parentId(replyToPost，缺省回退 replyTo) = 主帖 id；
 *  其余回复按真实父子关系嵌套在楼中楼里，不再扁平堆在一级 */
  const replies = post ? threadFirstLevel(d, postId) : [];
  /** 全部回复数（含多层楼中楼子孙） */
  const totalReplies = post ? descendantCountOf(d, postId) : 0;
  const [draft, setDraft] = useState('');
  /** 定向回复目标（null = 回复主帖作者）：commentId = 分组锚点（顶层评论 id），
 *  postId = 精确被回复的帖（多轮接话定位：AI 回应“我评论的那条”），name = 显示名 */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; postId: string; name: string } | null>(null);
  /** 「显示更多评论」生成中（engine 再生成 7~15 条；用户要求：打开帖子不自动生成） */
  const [moreLoading, setMoreLoading] = useState(false);
  /** AI 翻译：loading / 译文 / 是否展示 */
  const [tr, setTr] = useState<{ loading: boolean; text: string | null; shown: boolean }>({
    loading: false,
    text: null,
    shown: false,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!post) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[15px]" style={{ color: t.secondary }}>
        帖子不存在或已被删除
      </div>
    );
  }

  const a = resolveAuthor(post.authorKey);
  const liked = post.likes.includes(activeAuthorKey());
  const followed = d.following.includes(post.authorKey);
  const dt = new Date(post.createdAt);
  const dateStr = `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;

  /** 发送回复：v7 parentId 语义——直接回复主帖 → replyToPost 不落（一级评论）；
   *  定向回复某条评论 → replyTo = 分组锚点（顶层评论 id，AI 对话链上下文用），
   *  replyToPost = 那条评论的 id（树状嵌套挂到 TA 名下）。
   *  被回复对象作者是 AI 时，排一条 AI 再回复（带主帖+用户评论上下文，无限多轮）。 */
  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const nd = forumData();
    const groupId = replyTarget?.commentId ?? post.id;
    const exactId = replyTarget?.postId ?? post.id;
    const targetName = replyTarget?.name ?? a.name;
    // 回复归属当前活跃账号：匿名小号模式下，AI 看到的评论者就是小号网名（陌生网友）
    const me = activeAuthorKey();
    const reply: ForumPost = {
      id: uid('p'),
      authorKey: me,
      content: text.slice(0, REPLY_MAX),
      community: post.community,
      createdAt: Date.now(),
      likes: [],
      reposts: 0,
      views: 0,
      replyTo: groupId,
      replyToName: targetName,
      // 直接回复主帖 → undefined（一级评论）；回复评论 → 该评论 id（楼中楼嵌套）
      replyToPost: replyTarget ? exactId : undefined,
      reposted: false,
    };
    nd.posts.push(reply);
    saveForum({ ...nd });
    setDraft('');
    const targetPost = nd.posts.find((p) => p.id === exactId);
    // 网友/角色内容被回复 → 排围观回复（匿名小号的评论对 AI 也是陌生网友发言）；
    // 记忆写入/神回复仅大号（匿名评论不写角色记忆——认知隔离）
    if (targetPost && !isUserAuthor(targetPost.authorKey)) queueAiReplyToUserReply(exactId, reply.id, groupId, post.id);
    if (me === 'user' && targetPost?.authorKey.startsWith('char:')) {
      writeUserCommentMemory(targetPost.authorKey.slice(5), {
        post: targetPost.id === post.id ? targetPost : post,
        comment: reply,
        onOwnComment: targetPost.id !== post.id,
      });
    } else if (me === 'user' && post.authorKey.startsWith('char:')) {
      writeUserCommentMemory(post.authorKey.slice(5), { post, comment: reply, onOwnComment: false });
    }
    setReplyTarget(null);
  };

  /** 点击评论/子回复：定向回复并聚焦输入框（rootId 分组 + postId 精确定位） */
  const startReply = (rootId: string, postId: string, name: string) => {
    setReplyTarget({ commentId: rootId, postId, name });
    inputRef.current?.focus();
  };

  /** AI 翻译正文：中文 → 英语，外语 → 中文（带缓存与内置模型兜底；25s 超时保护）；
   *  v27：翻译前剥 [图片] 占位符（译文纯文字，配图仍由 PostBodyMedia 渲染不丢） */
  const runTranslate = () => {
    // 已有译文：切换展示/收起
    if (tr.text) {
      setTr((s) => ({ ...s, shown: !s.shown }));
      return;
    }
    const text = stripImgPh(post.content);
    if (!text || tr.loading) return;
    setTr({ loading: true, text: null, shown: false });
    translateForum(text)
      .then((out) => setTr({ loading: false, text: out, shown: true }))
      .catch((err) => {
        setTr({ loading: false, text: null, shown: false });
        translateFailToast(err, f.toast);
      });
  };

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏 */}
      <div
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{
          borderColor: t.border,
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-4 px-4 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <span className="text-[17px] font-bold">帖子</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* 原帖（X 放大规格） */}
        <div className="px-4 pt-3 pb-3">
          <div className="flex gap-3">
            <XAvatar authorKey={post.authorKey} size={48} onClick={() => f.openProfile(post.authorKey)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => f.openProfile(post.authorKey)}
                  className="max-w-[150px] truncate text-[16px] font-bold"
                  style={{ color: t.text }}
                >
                  {a.name}
                </button>
                {a.verified && <VerifiedBadge size={15} />}
                <span className="truncate text-[14px]" style={{ color: t.secondary }}>
                  @{a.handle}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {!isUserAuthor(post.authorKey) && (
                    <button
                      type="button"
                      aria-label={followed ? '取消关注' : '关注'}
                      onClick={() => {
                        const nd = forumData();
                        if (followed) nd.following = nd.following.filter((k) => k !== post.authorKey);
                        else nd.following = [...nd.following, post.authorKey];
                        f.toast(followed ? `已取消关注 ${a.name}` : `已关注 ${a.name}，「关注」页将出现 TA 的帖子`);
                        saveForum({ ...nd });
                      }}
                      className="flex h-[30px] items-center rounded-full px-4 text-[14px] font-bold transition-opacity active:opacity-60"
                      style={
                        followed
                          ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
                          : { background: t.text, color: t.bg, border: 'none' }
                      }
                    >
                      {followed ? '已关注' : '关注'}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="更多"
                    onClick={() => f.openPostMenu(post)}
                    className="flex h-8 w-8 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                    style={{ color: t.secondary }}
                  >
                    {XIcons.more(18)}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* 正文：翻译激活时原位替换为译文（X 官方行为），未翻译/收起时显示原文；
              v27 图文并茂：含 [图片] 占位符时按「正文段-文字图-正文段」分段交替渲染；
              【点击生图】：文字图卡片可点 → 生成弹层（真图原位替换卡片） */}
          <PostBodyMedia
            text={tr.shown && tr.text ? tr.text : post.content}
            media={post.media}
            onTextImg={(post.media ?? []).some((m) => m.startsWith('data:image/png')) ? (i) => f.openTextImgGen(post, i) : undefined}
          />
          {/* 翻译标注行（译文已原位替换正文） */}
          {tr.text && tr.shown && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px]" style={{ color: t.secondary }}>
              <Languages width={13} height={13} strokeWidth={1.9} aria-hidden="true" />
              由 AI 翻译
            </p>
          )}
          {/* 主帖投票 / 位置（附图已由 PostBodyMedia 分段/网格渲染） */}
          {post.poll && <PollBlock post={post} />}
          {post.location && <div className="mt-1"><LocationLine name={post.location} /></div>}
          {/* 版块来源引用卡已按用户要求删除（不再显示「来自版块 · 点击进入逛逛」） */}
          {/* 官方元数据行：H:mm · 年月日 · N 次浏览 + 蓝色「翻译」按钮 */}
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[14px]" style={{ color: t.secondary }}>
            <span>
              {dt.getHours()}:{String(dt.getMinutes()).padStart(2, '0')} ·{' '}
              <b style={{ color: t.text, fontWeight: 700 }}>{dateStr}</b> ·{' '}
              <b style={{ color: t.text, fontWeight: 700 }}>{countShort(post.views)} 次浏览</b>
            </span>
            <button
              type="button"
              onClick={runTranslate}
              disabled={tr.loading}
              className="ml-1 text-[14px] font-bold transition-opacity active:opacity-50 disabled:opacity-60"
              style={{ color: t.blue }}
              aria-label={tr.text ? (tr.shown ? '查看原文' : '查看译文') : 'AI 翻译帖子'}
            >
              {tr.loading ? '翻译中…' : tr.text ? (tr.shown ? '查看原文' : '查看译文') : '翻译'}
            </button>
          </p>
          {/* 互动栏（X 官方顺序：回复/转推/点赞/浏览/分享；用户要求：爱心旁边是浏览不是书签；
              浏览量与点赞数为分级热度值：十几/几十/几百/几千/几万/几十万/几百万） */}
          <div className="mt-1 flex items-center justify-between border-b py-3" style={{ borderColor: t.border }}>
            <ThreadAction
              icon={XIcons.reply(21)}
              count={totalReplies}
              label="回复"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => inputRef.current?.focus()}
            />
            <ThreadAction
              icon={XIcons.repost(21)}
              count={post.reposts}
              label={post.reposted ? '撤销转推' : '转推'}
              color={post.reposted ? t.green : t.secondary}
              hoverColor={t.green}
              hoverBg="rgba(0,186,124,0.12)"
              onClick={() => f.repostToggle(post.id)}
            />
            {/* 爱心归位：第三位（用户要求移回原位，与帖子卡操作行一致）；点赞数为分级热度值 */}
            <ThreadAction
              icon={XIcons.like(liked, 21)}
              count={likesOf(post)}
              label={liked ? '取消点赞' : '点赞'}
              color={liked ? t.pink : t.secondary}
              hoverColor={t.pink}
              hoverBg="rgba(249,24,128,0.12)"
              onClick={() => f.likeToggle(post.id)}
            />
            <ThreadAction
              icon={XIcons.views(21)}
              count={post.views}
              label="浏览量"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => f.toast(`这条帖子已有 ${countShort(post.views)} 次浏览`)}
            />
            <ThreadAction
              icon={XIcons.share(21)}
              label="分享"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => f.sharePost(post)}
            />
          </div>
        </div>

        {/* 评论流（参考图规格：X 官方回复卡 + 嵌套连接线） */}
        {replies.length === 0 ? (
          moreLoading ? (
            <div className="flex items-center justify-center gap-2 py-10" aria-live="polite">
              <span
                className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                aria-hidden="true"
              />
              <span className="text-[14px]" style={{ color: t.secondary }}>
                评论正在赶来…
              </span>
            </div>
          ) : (
            <p className="py-10 text-center text-[14px]" style={{ color: t.secondary }}>
              还没有回复，来抢沙发
            </p>
          )
        ) : (
          <div className="border-t" style={{ borderColor: t.border }}>
            {replies.map((r) => (
              <CommentRow key={r.id} comment={r} onReply={startReply} opAuthorKey={post.authorKey} />
            ))}
          </div>
        )}
        {/* 「显示更多评论」按钮：点击再生成 7~15 条（含楼中楼；用户要求：唯一的评论生成入口） */}
        <div className="px-4 py-4">
          <button
            type="button"
            disabled={moreLoading}
            onClick={() => {
              setMoreLoading(true);
              void generateMoreComments(post.id)
                .then((n) => {
                  if (n > 0) f.toast(`已生成 ${n} 条新评论`);
                  else f.toast('暂时没有更多评论，稍后再试');
                })
                .finally(() => setMoreLoading(false));
            }}
            className="flex h-[44px] w-full items-center justify-center gap-2 rounded-full border text-[15px] font-bold transition-opacity active:opacity-60 disabled:opacity-60"
            style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.blue }}
            aria-label="显示更多评论"
          >
            {moreLoading ? (
              <>
                <span
                  className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                  style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                  aria-hidden="true"
                />
                正在生成更多评论…
              </>
            ) : (
              '显示更多评论'
            )}
          </button>
        </div>
      </div>

      {/* 底部回复输入条（X：头像 + 输入 + 蓝发送钮；微信式定向回复提示条） */}
      <div className="shrink-0 border-t" style={{ borderColor: t.border, background: t.bg }}>
        {replyTarget && (
          <div className="flex items-center justify-between px-4 pt-1.5">
            <span className="truncate text-[12px] font-medium" style={{ color: t.blue }}>
              回复 @{replyTarget.name}
            </span>
            <button
              type="button"
              aria-label="取消定向回复"
              onClick={() => setReplyTarget(null)}
              className="shrink-0 pl-2 text-[12px] font-medium active:opacity-50"
              style={{ color: t.secondary }}
            >
              取消
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <XAvatar authorKey={activeAuthorKey()} size={34} />
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-4 h-[40px]" style={{ background: t.dark ? '#202327' : '#eff3f4' }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendReply();
                }
              }}
              placeholder={replyTarget ? `回复 ${replyTarget.name}…` : `回复 ${a.name}…`}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              style={{ color: t.text, caretColor: t.blue }}
              aria-label={replyTarget ? `回复 ${replyTarget.name}` : `回复 ${a.name}`}
            />
          </div>
          <button
            type="button"
            aria-label="发送回复"
            disabled={!draft.trim()}
            onClick={sendReply}
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40 active:opacity-70"
            style={{ background: t.blue }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M22 2 11 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
