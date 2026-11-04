'use client';

/**
 * 音乐 App 评论页（独立全屏界面，仿网易云 App 截图）：
 * - 头部：返回箭头（←）+ 居中「评论」标题（标题下红色短条）
 * - 歌曲行：圆形封面 + 「歌名 - 歌手」
 * - 排序档：「评论(N)」+ 推荐 | 最热 | 最新（/comment/new sortType 1/2/3，cursor 翻页；
 *   第三十三轮起吸顶不随滚动，标题栏/歌曲行随内容滑走；
 *   第三十四轮吸顶位改 top-[54px] 停在状态栏/灵动岛下方，不再与状态栏重叠；
 *   第三十六轮顶部加同色遮罩条，评论流不再从吸顶行上方缝隙穿到状态栏后）
 * - 评论流：头像 / 昵称 + VIP·等级徽章 / 日期 + IP 属地 / 内容 / 右侧点赞（大拇指），
 *   楼层回复内联直排（第三十二轮去卡片底色，进视口自动预览前 2 条，仿截图），
 *   「展开N条回复」蓝色链接（第三十三轮，/comment/floor）
 * - 底部：话题胶囊行 + 「听了这么多，可能你有话想说」输入条 + 「发送」文字键
 *   （点赞/发表需登录，游客 toast 引导）
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquareText,
  ThumbsUp,
} from 'lucide-react';
import {
  commentFloor,
  commentLike,
  commentsNew,
  getMusicLogin,
  postComment,
  songArtistText,
  songCover,
  type CommentSortType,
  type NcmComment,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { CoverImg, EmptyBlock, LoadingBlock, fmtPlayCount } from './music-shared';
// v59：评论区 VIP/SVIP 徽章改用「我的」页同款黑胶唱片胶囊（用户要求全 App 统一）
import { VipBadge } from './music-vip-badge';

type SortKey = 'rec' | 'hot' | 'new';
const SORT_ORDER: SortKey[] = ['rec', 'hot', 'new'];
const SORT_LABEL: Record<SortKey, string> = { rec: '推荐', hot: '最热', new: '最新' };
const SORT_TYPE: Record<SortKey, CommentSortType> = { rec: 1, hot: 2, new: 3 };

/** 底部话题胶囊（展示用，与网易云热榜话题同风格） */
const TOPICS = ['耳机常驻歌曲', '一听前奏就红心', '科学听歌大法', '单曲循环一整天'];

interface FloorState {
  open: boolean;
  loading: boolean;
  list: NcmComment[];
  total: number;
  /** 预览态：进视口自动拉的前 2 条内联展示（第三十二轮仿截图）；false=完整展开 */
  preview: boolean;
}

interface ListData {
  list: NcmComment[];
  total: number;
  hasMore: boolean;
  cursor: string;
}

export function CommentsPage() {
  const song = useMusic((s) => s.commentSong)!;
  const close = useMusic((s) => s.closeComments);
  const [sort, setSort] = useState<SortKey>('rec');
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [floors, setFloors] = useState<Record<number, FloorState>>({});
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<NcmComment | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 切排序/切歌时作废在途请求
  const seqRef = useRef(0);

  const showToast = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  };

  // 拉取一页（replace=true 首屏/切档；false = cursor 追加翻页）
  const load = async (key: SortKey, cursor = '', replace: boolean) => {
    const mySeq = seqRef.current;
    try {
      const page = await commentsNew(song.id, SORT_TYPE[key], 20, cursor);
      if (seqRef.current !== mySeq) return;
      setData((d) =>
        !replace && d
          ? { list: [...d.list, ...page.comments], total: page.total, hasMore: page.hasMore, cursor: page.cursor }
          : { list: page.comments, total: page.total, hasMore: page.hasMore, cursor: page.cursor },
      );
    } catch {
      if (seqRef.current !== mySeq) return;
      showToast('评论加载失败');
    } finally {
      if (seqRef.current === mySeq) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // 切歌/切排序：重置并重拉（楼层回复与输入引用一并清空；滚动回顶避免停在半途头部已滑走的状态）
  useEffect(() => {
    seqRef.current += 1;
    setData(null);
    setFloors({});
    setReplyTo(null);
    setLoading(true);
    listRef.current?.scrollTo({ top: 0 });
    void load(sort, '', true);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [song.id, sort]);

  const loadMore = () => {
    if (!data?.hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    void load(sort, data.cursor, false);
  };

  // 滚动近底部自动翻页
  const onListScroll = () => {
    const el = listRef.current;
    if (!el || !data?.hasMore || loadingMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 260) loadMore();
  };

  const like = async (c: NcmComment, floorId?: number) => {
    if (!getMusicLogin()) {
      showToast('登录后才能点赞');
      return;
    }
    try {
      await commentLike(song.id, c.commentId, c.liked ? 2 : 1);
      setData((d) =>
        d
          ? {
              ...d,
              list: d.list.map((x) =>
                x.commentId === c.commentId
                  ? { ...x, liked: !x.liked, likedCount: x.likedCount + (x.liked ? -1 : 1) }
                  : x,
              ),
            }
          : d,
      );
      const fl = floors[floorId ?? c.commentId];
      if (fl) {
        setFloors((m) => ({
          ...m,
          [c.commentId]: {
            ...fl,
            list: fl.list.map((x) =>
              x.commentId === c.commentId
                ? { ...x, liked: !x.liked, likedCount: x.likedCount + (x.liked ? -1 : 1) }
                : x,
            ),
          },
        }));
      }
    } catch {
      showToast('点赞失败');
    }
  };

  // 展开/收起楼层回复（预览态首次点击拉全量；收起只翻状态，内联仍显示前 2 条）
  const toggleFloor = async (c: NcmComment) => {
    const cur = floors[c.commentId];
    if (cur && (cur.open || cur.loading)) {
      setFloors((m) => ({ ...m, [c.commentId]: { ...cur, open: false, loading: false } }));
      return;
    }
    if (cur && !cur.preview && cur.list.length > 0) {
      setFloors((m) => ({ ...m, [c.commentId]: { ...cur, open: true } }));
      return;
    }
    setFloors((m) => ({
      ...m,
      [c.commentId]: {
        open: true,
        loading: true,
        list: cur?.list ?? [],
        total: c.showFloorComment?.replyCount ?? 0,
        preview: false,
      },
    }));
    try {
      const f = await commentFloor(song.id, c.commentId, 20);
      setFloors((m) => ({
        ...m,
        [c.commentId]: { open: true, loading: false, list: f.comments, total: f.total, preview: false },
      }));
    } catch {
      showToast('回复加载失败');
      setFloors((m) => ({
        ...m,
        [c.commentId]: {
          open: false,
          loading: false,
          list: cur?.list ?? [],
          total: cur?.total ?? c.showFloorComment?.replyCount ?? 0,
          preview: cur?.preview ?? false,
        },
      }));
    }
  };

  // 进视口静默预览：自动拉前 2 条回复内联展示（第三十二轮仿截图；失败不留痕可重试）
  const previewFloor = (c: NcmComment) => {
    const cid = c.commentId;
    setFloors((m) => {
      if (m[cid]) return m;
      return {
        ...m,
        [cid]: {
          open: false,
          loading: true,
          list: [],
          total: c.showFloorComment?.replyCount ?? 0,
          preview: true,
        },
      };
    });
    void (async () => {
      try {
        const f = await commentFloor(song.id, cid, 2);
        setFloors((m) => {
          const cur = m[cid];
          if (!cur || !cur.preview || cur.open) return m;
          return { ...m, [cid]: { ...cur, loading: false, list: f.comments, total: f.total } };
        });
      } catch {
        setFloors((m) => {
          if (!m[cid]) return m;
          const next = { ...m };
          delete next[cid];
          return next;
        });
      }
    })();
  };

  const send = async () => {
    if (!text.trim()) return;
    if (!getMusicLogin()) {
      showToast('登录后才能评论');
      return;
    }
    setSending(true);
    try {
      await postComment(song.id, text.trim(), replyTo?.commentId);
      setText('');
      setReplyTo(null);
      showToast('已发布');
      seqRef.current += 1;
      setLoading(true);
      setData(null);
      await load(sort, '', true);
    } catch {
      showToast('发布失败（可能需要实名/VIP）');
    } finally {
      setSending(false);
    }
  };

  const artist = songArtistText(song);

  return (
    <div
      className="absolute inset-0 z-[68] flex flex-col bg-white dark:bg-zinc-950"
      data-testid="music-comments"
    >
      {/* 顶部遮罩条（第三十六轮修复「评论界面还是有问题」）：吸顶行停在 top-[54px] 让出状态栏区，
          但评论流上滚时会从这条 0~54px 的缝隙里穿出去、和状态栏时间重叠（用户截图：长评论尾部
          露在「评论(N)」行上方）。盖一条与页面同色的不透明遮罩（pointer-events-none 不挡点击），
          内容从遮罩下穿过即被裁住；scroll=0 时该区域本就是头部留白，无视觉变化 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[54px] bg-white dark:bg-zinc-950"
      />
      {/* 滚动容器（第三十三轮）：向上滑动时标题栏与歌曲行跟随滑走，评论(N)+排序 tab 吸顶不随滚 */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="music-comment-list"
      >
        {/* 头部（随滚动滑走）：返回 + 居中「评论」标题（红色短条下划线，仿截图）；pt-[58px] 避让状态栏+灵动岛 */}
        <div className="relative border-b border-black/[0.04] px-3 pb-2 pt-[58px] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={close}
            aria-label="返回"
            data-testid="music-comment-back"
            className="absolute bottom-1 left-1.5 p-2 text-zinc-800 active:scale-95 dark:text-zinc-200"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="flex flex-col items-center">
            <p className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100">评论</p>
            <span
              className="mt-[3px] h-[3px] w-6 rounded-full bg-[#C20C0C]"
              aria-hidden
              data-testid="music-comment-underline"
            />
          </div>
        </div>

        {/* 歌曲行（随滚动滑走）：圆封面 + 歌名 - 歌手 */}
        <div className="flex items-center gap-3 px-4 py-3">
          <CoverImg src={songCover(song)} className="h-11 w-11 shrink-0" rounded="rounded-full" alt={song.name} />
          <p className="min-w-0 flex-1 truncate text-[16px]" data-testid="music-comment-song">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{song.name}</span>
            <span className="text-zinc-400"> - {artist}</span>
          </p>
        </div>

        {/* 排序档（吸顶不随滚动，且停在状态栏/灵动岛下方——第三十四轮修复：
            原先 top-0 滚动后计数行顶到状态栏上与其重叠，用户截图反馈） */}
        <div className="sticky top-[54px] z-10 flex items-center justify-between bg-white/85 px-4 pb-2 pt-2 backdrop-blur-xl dark:bg-zinc-950/85">
          <p className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100" data-testid="music-comment-total">
            评论{data ? `(${fmtPlayCount(data.total) || data.total})` : ''}
          </p>
          <div className="flex items-center">
            {SORT_ORDER.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && <span className="mx-3 h-3 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
                <button
                  type="button"
                  onClick={() => setSort(k)}
                  data-testid={`music-comment-sort-${k}`}
                  className={`text-[14px] active:opacity-70 ${
                    sort === k ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  {SORT_LABEL[k]}
                </button>
              </Fragment>
            ))}
          </div>
        </div>

        {/* 评论流（近底部自动翻页） */}
        <div className="px-4">
          {loading && !data ? (
            <LoadingBlock />
          ) : !data || data.list.length === 0 ? (
            <EmptyBlock text="还没有评论，来抢沙发" />
          ) : (
            <>
              {data.list.map((c) => (
                <CommentRow
                  key={`${sort}-${c.commentId}`}
                  c={c}
                  floor={floors[c.commentId]}
                  onLike={() => void like(c)}
                  onLikeFloor={(r) => void like(r, c.commentId)}
                  onReply={() => setReplyTo(c)}
                  onToggleFloor={() => void toggleFloor(c)}
                  onPreview={() => previewFloor(c)}
                />
              ))}
              {loadingMore && (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                </div>
              )}
              {!data.hasMore && data.list.length > 0 && (
                <p className="py-4 text-center text-[11px] text-zinc-300 dark:text-zinc-600">已经到底啦</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* 话题胶囊行 */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-black/[0.04] px-4 py-2 no-scrollbar dark:border-white/[0.06]">
        <button
          type="button"
          onClick={() => showToast('话题功能敬请期待')}
          className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white active:scale-95 dark:bg-zinc-700"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          话题
          <ChevronRight className="h-3 w-3" />
        </button>
        {TOPICS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => showToast('话题功能敬请期待')}
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.05] px-3 py-1.5 text-[12px] text-zinc-600 active:scale-95 dark:bg-white/10 dark:text-zinc-300"
          >
            <span className="text-zinc-400">#</span>
            {t}
          </button>
        ))}
      </div>

      {/* 回复引用条 */}
      {replyTo && (
        <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.04] px-4 py-1.5 text-[11px] text-zinc-400 dark:border-white/[0.06]">
          <span className="truncate">
            回复 {replyTo.user.nickname}：{replyTo.content}
          </span>
          <button type="button" onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-zinc-400">
            取消
          </button>
        </div>
      )}

      {/* 输入条：「听了这么多，可能你有话想说」+ 右侧「发送」文字键（有字变红，仿截图） */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-7 pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder={getMusicLogin() ? '听了这么多，可能你有话想说' : '登录后可评论（可先浏览）'}
          data-testid="music-comment-input"
          className="h-10 min-w-0 flex-1 rounded-full bg-black/[0.05] px-4 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-white/10 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          data-testid="music-comment-send"
          className={`shrink-0 text-[15px] active:opacity-70 ${
            text.trim() ? 'font-medium text-[#C20C0C]' : 'text-zinc-400'
          }`}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>

      {toast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-zinc-900/85 px-4 py-1.5 text-[12px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- 评论行 ----------------

function CommentRow({
  c,
  floor,
  onLike,
  onLikeFloor,
  onReply,
  onToggleFloor,
  onPreview,
}: {
  c: NcmComment;
  floor?: FloorState;
  onLike: () => void;
  /** 点赞楼层里的回复（floorId=父评论 id，乐观更新父楼层列表） */
  onLikeFloor: (r: NcmComment) => void;
  onReply: () => void;
  onToggleFloor: () => void;
  onPreview: () => void;
}) {
  const loc = c.ipLocation?.location || '';
  const replyCount = c.showFloorComment?.replyCount ?? 0;
  // 进视口自动预览前 2 条回复（第三十二轮仿截图：楼层内联直排）；rootMargin 提前预取
  const rowRef = useRef<HTMLDivElement>(null);
  const askedRef = useRef(false);
  useEffect(() => {
    if (replyCount <= 0 || floor) return;
    const el = rowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (askedRef.current || !es.some((e) => e.isIntersecting)) return;
        askedRef.current = true;
        io.disconnect();
        onPreview();
      },
      { rootMargin: '140px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [replyCount, floor, onPreview]);
  const list = floor?.list ?? [];
  const shown = floor?.open ? list : list.slice(0, 2);
  // 收起态下回复已全部内联展示（如只有 1~2 条）则隐藏展开链接
  const allCollapsed = !!floor && !floor.open && list.length > 0 && list.length >= floor.total;
  return (
    <div
      ref={rowRef}
      className="flex gap-3 border-b border-black/[0.04] py-3.5 last:border-b-0 dark:border-white/[0.06]"
    >
      <CoverImg src={c.user?.avatarUrl} className="h-10 w-10 shrink-0" rounded="rounded-full" alt={c.user?.nickname} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {/* 黑胶SVIP 用户昵称金色（网易云同款） */}
              <p
                className={`min-w-0 truncate text-[14px] font-medium ${
                  (c.user?.vipType ?? 0) >= 11
                    ? 'text-[#B9862C] dark:text-[#E8C275]'
                    : 'text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {c.user?.nickname}
              </p>
              <UserVipBadge user={c.user} />
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {commentDate(c)}
              {loc ? ` ${loc}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onLike}
            data-testid={`music-comment-like-${c.commentId}`}
            aria-label="点赞"
            className="flex shrink-0 items-center gap-1 pt-0.5 text-zinc-400 active:scale-95"
          >
            <span className="text-[12px] tabular-nums">{fmtPlayCount(c.likedCount)}</span>
            <ThumbsUp
              className={`h-4 w-4 ${c.liked ? 'text-[#C20C0C]' : ''}`}
              fill={c.liked ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        <p
          className="mt-1.5 whitespace-pre-wrap break-words text-[16px] leading-[1.65] text-zinc-900 dark:text-zinc-100"
          onClick={onReply}
        >
          {c.content}
        </p>
        {c.beRepliedComment && (
          <p className="mt-1 truncate rounded bg-black/[0.04] px-2 py-1 text-[11px] text-zinc-400 dark:bg-white/10">
            @{c.beRepliedComment.user?.nickname}：{c.beRepliedComment.content}
          </p>
        )}
        {/* 楼层回复：内联直排（去卡片底色，仿截图）；进视口自动预览前 2 条，展开后全量 */}
        {shown.length > 0 && (
          <div className="mt-2.5 space-y-3.5" data-testid={`music-comment-floor-list-${c.commentId}`}>
            {shown.map((r) => (
              <FloorReply key={r.commentId} r={r} onLike={() => onLikeFloor(r)} />
            ))}
          </div>
        )}
        {floor?.open && floor.loading && <p className="mt-2 text-[12px] text-zinc-400">回复加载中…</p>}
        {/* 展开/收起楼层回复（蓝色链接 + 横线前缀，第三十三轮按用户截图：「—— 展开48条回复 ∨」） */}
        {replyCount > 0 && !allCollapsed && (
          <button
            type="button"
            onClick={onToggleFloor}
            data-testid={`music-comment-floor-${c.commentId}`}
            className="mt-2.5 flex items-center gap-2 text-[13px] text-[#4791EB] active:opacity-70"
          >
            <span className="h-px w-6 bg-zinc-300 dark:bg-zinc-600" aria-hidden />
            {floor?.open ? '收起回复' : `展开${replyCount}条回复`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${floor?.open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {floor?.open && !floor.loading && floor.total > floor.list.length && (
          <p className="mt-1.5 text-[11px] text-zinc-400">仅展示前 {floor.list.length} 条回复</p>
        )}
      </div>
    </div>
  );
}

/** 楼层回复条目（内联直排：小头像 + 昵称 + VIP 徽章 / 日期 + IP / 内容 / 右侧点赞，仿截图） */
function FloorReply({ r, onLike }: { r: NcmComment; onLike: () => void }) {
  const loc = r.ipLocation?.location || '';
  return (
    <div className="flex gap-2">
      <CoverImg src={r.user?.avatarUrl} className="h-7 w-7 shrink-0" rounded="rounded-full" alt={r.user?.nickname} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 truncate text-[13px] text-zinc-500 dark:text-zinc-400">{r.user?.nickname}</p>
              <UserVipBadge user={r.user} />
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              {commentDate(r)}
              {loc ? ` ${loc}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onLike}
            data-testid={`music-comment-reply-like-${r.commentId}`}
            aria-label="点赞回复"
            className="flex shrink-0 items-center gap-1 pt-0.5 text-zinc-400 active:scale-95"
          >
            <span className="text-[11px] tabular-nums">{fmtPlayCount(r.likedCount)}</span>
            <ThumbsUp
              className={`h-3.5 w-3.5 ${r.liked ? 'text-[#C20C0C]' : ''}`}
              fill={r.liked ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-zinc-900 dark:text-zinc-100">
          {r.content}
        </p>
      </div>
    </div>
  );
}

/** 评论用户 VIP/SVIP 徽章（v59：黑胶唱片胶囊同「我的」页；vipType≥11 = SVIP，等级取 redVipLevel） */
function UserVipBadge({ user }: { user: NcmComment['user'] }) {
  const vip = user?.vipType ?? 0;
  if (vip <= 0) return null;
  const lv = user.vipRights?.redVipLevel ?? 0;
  return <VipBadge type={vip >= 11 ? 'svip' : 'vip'} level={lv} />;
}

/** 评论日期：同一年显示「MM-DD」、跨年「YYYY-MM-DD」（timeStr 优先） */
function commentDate(c: NcmComment): string {
  const s = c.timeStr || (c.time ? new Date(c.time).toLocaleDateString('zh-CN') : '');
  const y = `${new Date().getFullYear()}-`;
  return s.startsWith(y) ? s.slice(y.length) : s;
}
