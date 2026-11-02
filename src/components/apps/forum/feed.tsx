'use client';

/**
 * X论坛 · 时间线（帖子卡 / 列表 / 加载骨架）。
 * PostCard 严格按 X 官方规格：48px 圆头像 + 名行（名字/认证/·时间/更多）+
 * 社区来源行 + 正文 17px 行高 1.42 + 媒体网格 + 投票卡 + 位置行 +
 * 操作行（回复/转推/点赞/书签/分享，均匀铺满内容宽；深灰线条图标，
 * 悬停浅色圆底 + 图标/数字同步变色）。
 * 「···」更多按钮 → 底部弹层菜单（推荐/不感兴趣/举报，主框架渲染）。
 */

import { memo, type ReactNode } from 'react';
import {
  castVote as castVoteCore,
  countShort,
  forumData,
  likesOf,
  activeAuthorKey,
  relTime,
  repliesOf,
  resolveAuthor,
  replyTargetNameOf,
  type ForumPost,
  COMMUNITY_DEFS,
} from '@/lib/forum/core';
import { VerifiedBadge, XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

/** 正文渲染：#话题# 染品牌蓝（X hashtag 观感）。
 *  字数不限后长帖在时间线截断到 10 行 + 底部渐变（X 官方 Show more 观感；
 *  点击卡片仍打开详情页看全文），详情页不截断。 */
function PostText({ text, clamp = false }: { text: string; clamp?: boolean }) {
  const t = useXTheme();
  const parts = text.split(/(#[^#\s]{1,12}#)/g);
  const body = (
    <p
      className={`whitespace-pre-wrap break-words text-[17px] leading-[1.42] ${clamp ? 'line-clamp-[10]' : ''}`}
      style={{ color: t.text }}
    >
      {parts.map((p, i) =>
        /^#[^#\s]{1,12}#$/.test(p) ? (
          <span key={i} style={{ color: t.blue }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
  if (!clamp) return body;
  return (
    <div className="relative">
      {body}
      {/* 底部渐变提示还有更多内容（点击卡片展开全文） */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-7"
        style={{ background: `linear-gradient(to top, ${t.bg}, transparent)` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** 操作行悬停浅色圆底（X 官方：蓝/绿/粉 12% 透明度） */
const HOVER_BG = {
  blue: 'rgba(29,155,240,0.12)',
  green: 'rgba(0,186,124,0.12)',
  pink: 'rgba(249,24,128,0.12)',
};

/** 操作行单个图标按钮（X 官方：深灰线条 + 数字同色；
 *  悬停浮出浅色圆底、图标与数字同步变色；均分铺满整行） */
function ActionBtn({
  icon,
  count,
  color,
  hoverColor,
  hoverBg,
  onClick,
  label,
}: {
  icon: React.ReactNode;
  count?: number;
  color: string;
  hoverColor: string;
  hoverBg: string;
  onClick?: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-[3px] rounded-full p-[5px] transition-colors active:opacity-60"
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
        <span className="pr-[3px] text-[13px] leading-none">{countShort(count)}</span>
      )}
    </button>
  );
}

// ---------------- 媒体 / 投票 / 位置（PostCard 与 thread 主帖共用） ----------------

/** v34 文字图识别：renderTextImage 直出的 PNG dataURL。相册上传图
 *  （fileToPostMedia）非 GIF 一律转 JPEG、GIF 原样保留，永不产生 PNG——
 *  故 media 里的 `data:image/png` 必为文字图片（用户手发或 AI 配图）。 */
const isTextImg = (m: string) => m.startsWith('data:image/png');

/** v34 文字图卡（统一尺寸）：w-3/4 方图原样不裁切、白底圆角描边。
 *  AI 配图帖与用户手发文字图片共用，保证所有文字图「一样大」。
 *  【点击生图】：onTextImg 存在时卡片可点（无角标，点卡片即弹生成弹层，
 *  提示词预填源文本可改）→ 生成的真图原位替换卡片。 */
function TextImgCard({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  const inner = <img src={src} alt={alt} className="aspect-square w-full select-none" draggable={false} loading="lazy" />;
  return (
    <div
      className={`relative mt-2.5 w-3/4 overflow-hidden rounded-2xl border bg-white ${onClick ? 'transition-transform active:scale-[0.985]' : ''}`}
      style={{ borderColor: 'rgba(137,151,166,0.35)' }}
    >
      {onClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // 点卡片生图，不触发开帖
            onClick();
          }}
          aria-label="点击用文字生成真实图片"
          className="block w-full"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
    </div>
  );
}

/** 帖子附图网格（X 官方观感）：1 张 16:9 大图；2 张两列方图；3-4 张 2x2 宫格。
 *  v34：文字图片（PNG）不再混进相册网格被 16:9 / object-cover 裁切放大——
 *  先拆分：相册图（JPEG/GIF）走原网格，文字图每张单独 w-3/4 方卡
 *  （与 AI 配图帖同尺寸），所有文字图大小完全一致。
 *  【点击生图】：onTextImg = 点文字图回调（参数 = 该图在 media 里的下标）。 */
export function PostMedia({ media, onTextImg }: { media: string[]; onTextImg?: (index: number) => void }) {
  if (!media.length) return null;
  const textImgs = media.filter(isTextImg);
  const photos = media.filter((m) => !isTextImg(m));
  let photoGrid: ReactNode = null;
  if (photos.length === 1) {
    photoGrid = (
      <div className="mt-2.5 overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(137,151,166,0.35)' }}>
        <img src={photos[0]} alt="帖子图片" className="aspect-[16/9] w-full select-none object-cover" draggable={false} loading="lazy" />
      </div>
    );
  } else if (photos.length > 1) {
    const cells = photos.length === 3 ? [photos[0], photos[1], photos[2]] : photos.slice(0, 4);
    photoGrid = (
      <div className="mt-2.5 grid grid-cols-2 gap-[3px] overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(137,151,166,0.35)' }}>
        {cells.map((m, i) => (
          <img
            key={i}
            src={m}
            alt={`帖子图片 ${i + 1}`}
            className={`aspect-square w-full select-none object-cover ${photos.length === 3 && i === 2 ? 'col-span-2' : ''}`}
            draggable={false}
            loading="lazy"
          />
        ))}
      </div>
    );
  }
  return (
    <>
      {photoGrid}
      {media.map((m, i) =>
        isTextImg(m) ? (
          <TextImgCard key={`ti-${i}`} src={m} alt="文字图片" onClick={onTextImg ? () => onTextImg(i) : undefined} />
        ) : null,
      )}
    </>
  );
}

/** v32 图文并茂正文（用户要求）：图卡一律放正文最后——含 [图片] 占位符的
 *  AI 配图帖剥掉占位符、正文完整连续渲染，图卡（纯白底居中文字图，1:1 原样
 *  不裁切）追加在正文末尾；无占位符（用户手发帖/译文）→ 原样正文 + 图网格
 *  （图本来就在正文后）。文字图卡显示宽度收窄到 75%（用户要求「图片小一点」，
 *  白底文字图不再占满整行）。thread 详情页与 feed 帖子卡共用；clamp 仅时间线截断。
 *  v34（用户要求「我的文字图片大小也变成一样大」）：用户手发的文字图片
 *  （发布弹层「文字图片」直出的 PNG）与 AI 配图帖的图卡完全同尺寸——
 *  PostMedia 拆出文字图单独用 TextImgCard（w-3/4 方图不裁切）渲染，
 *  相册图照旧 16:9/宫格；全部文字图（无论谁发）大小一致。 */
export function PostBodyMedia({
  text,
  media,
  clamp = false,
  onTextImg,
}: {
  text: string;
  media?: string[];
  clamp?: boolean;
  /** 【点击生图】点文字图回调（参数 = 该图在 media 里的下标）；不传 = 不可点 */
  onTextImg?: (index: number) => void;
}) {
  const imgs = media ?? [];
  if (!text.includes('[图片]') || !imgs.length) {
    return (
      <>
        <PostText text={text} clamp={clamp} />
        {imgs.length > 0 && <PostMedia media={imgs} onTextImg={onTextImg} />}
      </>
    );
  }
  // v32：剥掉占位符，正文完整连续渲染（不再「文字段-图-文字段」交替）；
  // 图卡统一追加在正文最后（i 对应第几张图，单帖配图只用 imgs[0]）。
  // v34：图卡改用 TextImgCard（与用户手发文字图共用组件，尺寸完全一致）
  // 【点击生图】：占位符分支只对仍是文字图（PNG）的 imgs[0] 生效——
  //  已点击升级成真图的（JPEG）走普通图网格，不臆渲染成白底卡。
  const body = text
    .split('[图片]')
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return (
    <>
      <PostText text={body} clamp={clamp} />
      {isTextImg(imgs[0]) ? (
        <TextImgCard src={imgs[0]} alt="帖子配图（文字图）" onClick={onTextImg ? () => onTextImg(0) : undefined} />
      ) : (
        <PostMedia media={imgs} onTextImg={onTextImg} />
      )}
    </>
  );
}

/** 投票卡（X 官方样式）：未投 → 圆角描边选项行；已投 → 进度条 + 百分比 */
export function PollBlock({ post }: { post: ForumPost }) {
  const t = useXTheme();
  const poll = post.poll;
  if (!poll) return null;
  const voted = typeof poll.voted === 'number' && poll.voted >= 0;
  const votes = poll.votes.length === poll.options.length ? poll.votes : poll.options.map(() => 0);
  const total = votes.reduce((s, v) => s + v, 0);
  return (
    <div className="mt-2.5 flex flex-col gap-2" role="group" aria-label="帖子投票">
      {poll.options.map((opt, i) => {
        const pct = total > 0 ? Math.round((votes[i] / total) * 100) : 0;
        const mine = poll.voted === i;
        if (!voted) {
          return (
            <button
              key={i}
              type="button"
              aria-label={`投票给「${opt}」`}
              onClick={(e) => {
                e.stopPropagation();
                castVoteCore(post.id, i);
              }}
              className="flex items-center gap-2.5 text-left"
            >
              <span
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]"
                style={{ borderColor: t.blue }}
                aria-hidden="true"
              />
              <span className="truncate text-[15px]" style={{ color: t.text }}>
                {opt}
              </span>
            </button>
          );
        }
        return (
          <div key={i} className="relative overflow-hidden rounded-[6px]" aria-label={`「${opt}」${pct}%`}>
            <span
              className="absolute inset-y-0 left-0 rounded-[6px] transition-[width]"
              style={{
                width: `${pct}%`,
                minWidth: pct > 0 ? '8px' : 0,
                background: mine ? 'rgba(29,155,240,0.55)' : t.dark ? 'rgba(231,233,234,0.18)' : 'rgba(15,20,25,0.10)',
              }}
              aria-hidden="true"
            />
            <span className="relative flex items-center justify-between rounded-[6px] px-3 py-[7px]">
              <span className="flex items-center gap-1.5 truncate text-[15px]" style={{ color: t.text }}>
                {opt}
                {mine && (
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke={t.blue} strokeWidth="3" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="ml-2 shrink-0 text-[14px] font-bold" style={{ color: t.text }}>
                {pct}%
              </span>
            </span>
          </div>
        );
      })}
      <p className="text-[13px]" style={{ color: t.secondary }}>
        {total > 0 ? `${countShort(total)} 人参与 · ` : ''}投票截止时间未定
      </p>
    </div>
  );
}

/** 位置行（用户要求美化：品牌蓝定位胶囊 + 精修定位图标，帖子卡与 thread 主帖共用） */
export function LocationLine({ name }: { name: string }) {
  const t = useXTheme();
  return (
    <p
      className="mt-2 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[13px] font-medium"
      style={{
        color: t.blue,
        background: t.dark ? 'rgba(29,155,240,0.12)' : 'rgba(29,155,240,0.08)',
      }}
      aria-label={`位置：${name}`}
    >
      {/* 精修定位图标：品牌蓝描边水滴 + 实心圆心 */}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
        <path
          d="M12 21.5s-7.5-5.9-7.5-11.4a7.5 7.5 0 1 1 15 0c0 5.5-7.5 11.4-7.5 11.4Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10" r="2.6" fill="currentColor" />
      </svg>
      {name}
    </p>
  );
}

/** X 帖子卡（时间线/回复列表通用） */
export const PostCard = memo(function PostCard({ post, onOpen }: { post: ForumPost; onOpen?: () => void }) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(post.authorKey);
  // 红心状态跟当前活跃账号（大号/小号点赞互相隔离）
  const liked = post.likes.includes(activeAuthorKey());
  const repostedByMe = post.reposted === true;
  const time = relTime(post.createdAt);
  const replyCount = repliesOf(forumData(), post.id).length;
  const likeCount = likesOf(post);
  const media = post.media ?? [];
  const scheduled = typeof post.visibleAt === 'number' && post.visibleAt > Date.now();
  // v7：回复对象名动态解析（父帖作者当前昵称）——存死的 replyToName 在 NPC 被
  // LLM 改名后会变成「从没出现过的人」；这里不存快照，每次渲染都取真名
  const replyToName = replyTargetNameOf(post);

  return (
    <article
      className="cursor-pointer border-b px-4 py-3 transition-colors"
      style={{ borderColor: t.border, background: 'transparent' }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return; // 按钮点击不触发开帖
        onOpen?.();
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="flex gap-3">
        <XAvatar authorKey={post.authorKey} size={48} onClick={() => f.openProfile(post.authorKey)} />
        <div className="min-w-0 flex-1">
          {/* 名行：名字 + 认证 + @handle · 时间 + 更多 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => f.openProfile(post.authorKey)}
              className="max-w-[120px] shrink truncate text-[15px] font-bold"
              style={{ color: t.text }}
            >
              {a.name}
            </button>
            {a.verified && <VerifiedBadge size={14} />}
            <span className="truncate text-[15px]" style={{ color: t.secondary }}>
              @{a.handle} · {time}
            </span>
            <button
              type="button"
              aria-label="更多"
              onClick={(e) => {
                e.stopPropagation();
                f.openPostMenu(post);
              }}
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
              style={{ color: t.secondary }}
            >
              {XIcons.more(18)}
            </button>
          </div>
          {/* 回复对象（X：回复 @xx；动态取父帖作者当前昵称，改名不错位） */}
          {replyToName && (
            <p className="mb-[2px] text-[14px]" style={{ color: t.secondary }}>
              回复 <span style={{ color: t.blue }}>@{replyToName}</span>
            </p>
          )}
          {/* v8：按用户要求移除帖子名下方的社区来源标签（#影视片单# 等），
              时间线更贴近 X 官方（帖子只显示名字行 + 正文） */}
          {/* v27 图文并茂：含 [图片] 占位符时正文-文字图-正文分段交替渲染；
              【点击生图】：文字图卡片可点 → 生成弹层（真图原位替换） */}
          <PostBodyMedia
            text={post.content}
            media={media}
            clamp={post.content.length > 240}
            onTextImg={media.some((m) => m.startsWith('data:image/png')) ? (i) => f.openTextImgGen(post, i) : undefined}
          />
          {post.poll && <PollBlock post={post} />}
          {post.location && <LocationLine name={post.location} />}
          {/* 定时标记（列表一般不会出现未到时间的帖子；详情打开时可见） */}
          {scheduled && (
            <p className="mt-1 text-[13px]" style={{ color: t.secondary }}>
              ⏱ 定时发布 · {new Date(post.visibleAt!).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 自动发出
            </p>
          )}
          {/* 操作行：X 官方顺序 回复/转推/点赞/浏览/分享（用户要求：爱心旁边是浏览不是书签；
              浏览量与点赞数为分级热度值：十几/几十/几百/几千/几万/几十万/几百万） */}
          <div className="mt-2 mb-1 flex w-full items-center justify-between">
            <ActionBtn
              icon={XIcons.reply()}
              count={replyCount}
              label="回复"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg={HOVER_BG.blue}
              onClick={() => f.openThread(post.id)}
            />
            <ActionBtn
              icon={XIcons.repost()}
              count={post.reposts}
              label="转推"
              color={repostedByMe ? t.green : t.secondary}
              hoverColor={t.green}
              hoverBg={HOVER_BG.green}
              onClick={() => f.repostToggle(post.id)}
            />
            <ActionBtn
              icon={XIcons.like(liked)}
              count={likeCount}
              label={liked ? '取消点赞' : '点赞'}
              color={liked ? t.pink : t.secondary}
              hoverColor={t.pink}
              hoverBg={HOVER_BG.pink}
              onClick={() => f.likeToggle(post.id)}
            />
            <ActionBtn
              icon={XIcons.views()}
              count={post.views}
              label="浏览量"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg={HOVER_BG.blue}
              onClick={() => f.toast(`这条帖子已有 ${countShort(post.views)} 次浏览`)}
            />
            <ActionBtn
              icon={XIcons.share()}
              label="分享"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg={HOVER_BG.blue}
              onClick={() => f.sharePost(post)}
            />
          </div>
        </div>
      </div>
    </article>
  );
});

/** 时间线列表（已过滤排序好的 posts）+ 底部提示（可由主页传入无限生成 loading footer） */
export function FeedList({ posts, footer }: { posts: ForumPost[]; footer?: React.ReactNode }) {
  const t = useXTheme();
  const f = useForum();
  return (
    <div>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
      ))}
      {footer ?? (
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          {posts.length ? '已经到底啦 · X论坛' : ''}
        </p>
      )}
    </div>
  );
}

/** X 风格加载骨架（灰圆 + 两灰条） */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  const t = useXTheme();
  return (
    <div aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b px-4 pt-3 pb-4" style={{ borderColor: t.border }}>
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full" style={{ background: t.border }} />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 animate-pulse rounded-full" style={{ background: t.border }} />
            <div className="h-3 w-full animate-pulse rounded-full" style={{ background: t.border }} />
            <div className="h-3 w-2/3 animate-pulse rounded-full" style={{ background: t.border }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 空状态（X：居中灰字 + 行动按钮） */
export function EmptyState({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) {
  const t = useXTheme();
  return (
    <div className="flex flex-col items-center gap-4 px-10 pt-20 text-center">
      <p className="text-[15px] leading-relaxed" style={{ color: t.secondary }}>
        {text}
      </p>
      {action && actionLabel && (
        <button
          type="button"
          onClick={action}
          className="rounded-full px-5 h-[34px] text-[14px] font-bold text-white active:opacity-70"
          style={{ background: t.blue }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** 社区色卡（社区页/列表共用） */
export function CommunityIcon({ id, size = 44 }: { id: string; size?: number }) {
  const def = COMMUNITY_DEFS.find((c) => c.id === id);
  const bg = def?.coverBg ?? '#1d9bf0';
  const ch = (def?.name ?? '论').slice(0, 1);
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[14px] font-bold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
    >
      {ch}
    </div>
  );
}
