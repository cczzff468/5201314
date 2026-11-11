'use client';

/** 朋友圈流 + 发布朋友圈页 —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useRef, useState } from 'react';
import { AtSign, Camera, Heart, Loader2, MapPin, MessageCircle, Pencil, Plus, Smile, Trash2, Undo2, User, X, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
import { regenerateMomentImage, upgradeMomentTextCard } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { BilingualTranslation, CommentDeleteDialog, MomentsEmojiPanel, insertEmojiAtCursor } from '../moments-shared';
import { getMomentsSettings } from '@/lib/ios/moments-settings';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { getWxBg, setWxBg, getPeerBg, setPeerBg, removePeerBg } from '@/lib/ios/contacts-store';
import { TextCardBubble } from '@/components/apps/text-card-bubble';
import { ImageRegenSheet } from '@/components/apps/image-regen-sheet';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）

import { LocationPickerPage } from './cards';
import { WxMoment, WxMomentComment, WxUser, fmtMomentsTime, readImageFile } from './core';
import { WxAvatar } from './widgets';

// ---------------- 朋友圈页 ----------------

/** A1/A2 朋友圈「生成图片」弹层（iOS 风格底部小弹层，样式对齐 WxTextCardSheet/ImageRegenSheet）：
 *  文字图片卡片升级真图（A1）与升级图重新生成（A2）共用——描述预填可改（无硬限，提交时 trim + 截 400）、
 *  主按钮 busy 时「生成中…」禁用、错误信息显示在弹层内（失败留在弹层可重试）、取消关闭（busy 时不可关） */
export function MomentImageGenSheet({
  title,
  initialDesc,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  initialDesc: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (desc: string) => void;
}) {
  const [desc, setDesc] = useState(initialDesc);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="wx-moment-imggen-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1C1C1E]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold">{title}</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid="wx-moment-imggen-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          disabled={busy}
          rows={3}
          data-testid="wx-moment-imggen-input"
          placeholder="画面描述（可修改后再生成）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] outline-none placeholder:text-black/30 focus:border-[#07C160]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="wx-moment-imggen-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="wx-moment-imggen-submit"
          onClick={() => onSubmit(desc)}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#07C160] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              生成中…
            </>
          ) : (
            '生成图片'
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-black/35 dark:text-white/35">生成成功后照片会替换原位置（需在 设置 › 图像生成 完成配置）</p>
      </div>
    </div>
  );
}

/** 单条动态 */
export function MomentRow({
  post,
  meName,
  menuOpen,
  onToggleMenu,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
  onUpgradeCard,
  onRegenImage,
  cardBusy,
}: {
  post: WxMoment;
  /** 机主展示名（点赞高亮用） */
  meName: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleLike: () => void;
  onComment: (text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: () => void;
  /** 长按评论删除（任何人的评论都可删，其下回复一并删；好友朋友圈页不传） */
  onDeleteComment?: (commentId: string) => void;
  /** 编辑动态正文（自己的和 AI 的都可以编辑；好友朋友圈页不传） */
  onEditRequest?: () => void;
  /** 点击「文字图片」卡片（AI 配图降级产物）→ 打开「生成图片」弹层（描述可改）升级为真图；不传 = 不可点击 */
  onUpgradeCard?: () => void;
  /** A2 长按升级图 → 打开「重新生成图片」弹层（仅引擎升级过的图有入口，用户手动发的图不传） */
  onRegenImage?: () => void;
  /** 卡片正在生成真图（点击防重） */
  cardBusy?: boolean;
}) {
  /** 48-6：朋友圈设置·折叠中文译文（组件挂载时读一次，避免每次 render 读 kv；用户改设置后跳回本页重新挂载可生效）。
   *  feat-64：设置按平台独立（只读微信朋友圈这一份） */
  const [foldByDefault] = useState(() => getMomentsSettings('wx').foldChineseTranslation);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /** 回复目标：点某条评论设置（再点一次取消），带评论 id（回复 AI 评论可触发多轮） */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; name: string } | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delTarget, setDelTarget] = useState<{ id: string; author: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  /** 长按计时器 + 起点坐标（移动超阈值视为滚动取消）+ 长按后拦截紧随的 click */
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);

  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  useEffect(() => clearPress, []);

  const startCommentPress = (c: WxMomentComment) => (e: React.PointerEvent) => {
    if (!onDeleteComment) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelTarget({ id: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  /** A2 升级图长按 → 打开「重新生成图片」弹层（复用评论长按同款计时器/移动取消/抑制 click 模式） */
  const startImagePress = (e: React.PointerEvent) => {
    if (!onRegenImage) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      onRegenImage();
    }, 480);
  };
  const onImagePointerMove = (e: React.PointerEvent) => {
    if (!onRegenImage) return;
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  useEffect(() => {
    if (composerOpen) inputRef.current?.focus();
  }, [composerOpen, replyTarget]);

  /** 评论框打开时，点击输入框以外的任意位置自动收起（不想评论了点别处即可关闭） */
  useEffect(() => {
    if (!composerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (composerRef.current && target && composerRef.current.contains(target)) return;
      setComposerOpen(false);
      setReplyTarget(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [composerOpen]);

  const sendComment = () => {
    const text = draft.trim();
    if (!text) return;
    onComment(text, replyTarget);
    setDraft('');
    setReplyTarget(null);
    setComposerOpen(false);
  };

  return (
    /* wx-moments-post：朋友圈动态卡锚点（自定义 CSS 示例模板可改卡底/分割线/内距） */
    <div className="wx-moments-post flex gap-3 border-b border-black/[0.06] px-4 py-3 last:border-b-0 dark:border-white/[0.08]">
      <WxAvatar src={post.avatar} alt={post.authorName} size={44} />
      <div className="min-w-0 flex-1">
        <p className="wx-moments-name text-[15px] font-medium text-[#576B95] dark:text-[#8FA5C9]">{post.authorName}</p>
        {post.text && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.5]">{post.text}</p>
        )}
        <BilingualTranslation zh={post.contentZh ?? ''} foldByDefault={foldByDefault} />
        {/* 「文字图片」卡片（AI 配图降级产物）：韩系简约卡片直接当配图，点击可升级为真图 */}
        {post.textCard && post.images.length === 0 && (
          <div className="mt-2">
            <TextCardBubble
              text={post.textCard}
              signedBy={post.authorName}
              variant="wx"
              onClick={onUpgradeCard}
            />
            {cardBusy && <p className="mt-1 text-[12px] text-black/35 dark:text-white/35">正在生成图片…</p>}
          </div>
        )}
        {post.images.length === 1 && (
          <img
            src={post.images[0]}
            alt="配图"
            className="mt-2 max-h-[280px] w-auto max-w-[200px] rounded-[4px] border border-black/5 object-cover dark:border-white/10"
            {...(onRegenImage
              ? {
                  // A2 长按升级图 →「重新生成图片」弹层（桌面端右键同入口；仅 textCardUpgraded 图有此 handler）
                  onPointerDown: startImagePress,
                  onPointerMove: onImagePointerMove,
                  onPointerUp: clearPress,
                  onPointerLeave: clearPress,
                  onPointerCancel: clearPress,
                  onContextMenu: (e: React.MouseEvent) => {
                    e.preventDefault();
                    onRegenImage();
                  },
                }
              : {})}
          />
        )}
        {post.images.length > 1 && (
          <div className="mt-2 grid max-w-[237px] grid-cols-3 gap-1">
            {post.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`配图${i + 1}`}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded-[3px] object-cover"
              />
            ))}
          </div>
        )}

        {/* 转发引用卡（引擎层支持；QQ 空间转发，微信侧仅兼容展示） */}
        {post.repostOf && (
          <div className="mt-2 rounded-[4px] bg-[#F7F7F7] px-2.5 py-2 dark:bg-[#242424]">
            <p className="text-[13.5px] leading-[1.5]">
              <span className="text-[#576B95] dark:text-[#8FA5C9]">{post.repostOf.authorName}：</span>
              <span className="text-black/70 dark:text-white/70">{post.repostOf.content}</span>
            </p>
            {post.repostOf.images.length > 0 && (
              <div className="mt-1.5 flex gap-1">
                {post.repostOf.images.slice(0, 3).map((src, i) => (
                  <img key={i} src={src} alt="转发配图" className="h-14 w-14 rounded-[3px] object-cover" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 位置行（发动态时选了「所在位置」才显示，微信同款蓝字） */}
        {post.location && (
          <p className="mt-1.5 flex items-center gap-1 text-[13px] text-[#576B95] dark:text-[#8FA5C9]" data-testid={`wx-moment-location-${post.id}`}>
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            <span className="truncate">{post.location}</span>
          </p>
        )}

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[12.5px] text-black/35 dark:text-white/35">{fmtMomentsTime(post.time)}</span>
          <button
            type="button"
            aria-label="赞与评论"
            data-testid={`wx-moment-menu-${post.id}`}
            onClick={onToggleMenu}
            className="wx-moments-act flex items-center gap-[3px] rounded-[4px] bg-[#F2F2F2] px-2.5 py-1 active:bg-black/10 dark:bg-[#2A2A2A] dark:active:bg-white/10"
          >
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
          </button>
        </div>

        {menuOpen && (
          <div className="mt-2 flex justify-end" data-testid={`wx-moment-actions-${post.id}`}>
            {/* 第七十四轮（用户指定：菜单文字要横向平行）：四个按钮 + 分隔线在内容列宽内放不下 →
                按钮收紧内距/字号并加 whitespace-nowrap shrink-0（CJK 逐字换行是 min-width:auto
                把按钮压到一字宽导致的）；总宽 ≈ 260px < 内容列 ≈ 302px，完整显示不裁切 */}
            <div className="flex overflow-hidden rounded-[6px] bg-[#4C4C4C] text-white shadow-md dark:bg-[#383838]">
              <button
                type="button"
                data-testid={`wx-moment-like-${post.id}`}
                onClick={onToggleLike}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
              >
                <Heart className={`h-4 w-4 ${post.likes.includes(meName) ? 'fill-[#FA5151] text-[#FA5151]' : ''}`} strokeWidth={1.8} />
                {post.likes.includes(meName) ? '取消' : '赞'}
              </button>
              <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-comment-open-${post.id}`}
                onClick={() => {
                  setComposerOpen(true);
                  onToggleMenu();
                }}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
                评论
              </button>
              {onEditRequest && (
                <>
                  <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
                  <button
                    type="button"
                    data-testid={`wx-moment-edit-${post.id}`}
                    onClick={onEditRequest}
                    className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.8} />
                    编辑
                  </button>
                </>
              )}
              <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-delete-${post.id}`}
                onClick={onDelete}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] text-[#FF9C9C] active:bg-white/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                删除
              </button>
            </div>
          </div>
        )}

        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="relative mt-2">
            <span
              className="absolute -top-[4px] left-[12px] h-2 w-2 rotate-45 rounded-[1px] bg-[#F7F7F7] dark:bg-[#242424]"
              aria-hidden="true"
            />
            <div className="relative rounded-[4px] bg-[#F7F7F7] px-2 py-1.5 text-[13px] dark:bg-[#242424]">
              {post.likes.length > 0 && (
                <div className="flex items-center gap-1.5 text-[#576B95] dark:text-[#8FA5C9]">
                  <Heart className="h-3.5 w-3.5 shrink-0 fill-[#576B95] dark:fill-[#8FA5C9]" strokeWidth={0} aria-hidden="true" />
                  <span className="min-w-0 truncate">{post.likes.join('、')}</span>
                </div>
              )}
              {post.likes.length > 0 && post.comments.length > 0 && (
                <span className="my-1.5 block h-px bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true" />
              )}
              {post.comments.length > 0 && (
                <div className="min-w-0">
                  {post.comments.map((c) => (
                    <div key={c.id}>
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          data-testid={`wx-moment-comment-${post.id}-${c.id}`}
                          title={`回复 ${c.author}（长按删除）`}
                          onPointerDown={startCommentPress(c)}
                          onPointerUp={clearPress}
                          onPointerLeave={clearPress}
                          onPointerCancel={clearPress}
                          onPointerMove={onCommentPointerMove}
                          onClick={() => {
                            // 长按后拦截紧随的 click（不弹出回复框）
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            setComposerOpen(true);
                            setReplyTarget((r) => (r && r.commentId === c.id ? null : { commentId: c.id, name: c.author }));
                          }}
                          className="min-w-0 flex-1 text-left text-[13px] leading-[1.6] active:opacity-70"
                        >
                          <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.author}</span>
                          {c.replyTo && (
                            <>
                              <span className="text-black/85 dark:text-white/85"> 回复 </span>
                              <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.replyTo}</span>
                            </>
                          )}
                          <span className="text-black/85 dark:text-white/85">：{c.text}</span>
                        </button>
                      </div>
                      <BilingualTranslation zh={c.contentZh ?? ''} foldByDefault={foldByDefault} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {composerOpen && (
          <div ref={composerRef} className="mt-2 flex items-center gap-2" data-testid={`wx-moment-commentbar-${post.id}`}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendComment();
                }
              }}
              placeholder={replyTarget ? `回复 ${replyTarget.name}：` : '评论'}
              aria-label={replyTarget ? `回复 ${replyTarget.name}` : '写评论'}
              data-testid={`wx-moment-comment-input-${post.id}`}
              className="h-8 min-w-0 flex-1 rounded-[4px] bg-[#F7F7F7] px-2.5 text-[13.5px] outline-none placeholder:text-black/30 focus:bg-white focus:ring-1 focus:ring-black/15 dark:bg-[#242424] dark:placeholder:text-white/30 dark:focus:bg-[#1F1F1F] dark:focus:ring-white/20"
            />
            <button
              type="button"
              data-testid={`wx-moment-comment-send-${post.id}`}
              onClick={sendComment}
              disabled={!draft.trim()}
              className="shrink-0 rounded-[4px] bg-[#07C160] px-3.5 py-[7px] text-[13px] font-medium text-white disabled:opacity-40 active:opacity-80"
            >
              发送
            </button>
          </div>
        )}

        {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
        {delTarget && onDeleteComment && (
          <CommentDeleteDialog
            author={delTarget.author}
            onCancel={() => setDelTarget(null)}
            onDelete={() => {
              onDeleteComment(delTarget.id);
              setDelTarget(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function MomentsPage({
  me,
  owner,
  peerId,
  posts,
  onBack,
  onCompose,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
  onToast,
  noticeBadge,
  onOpenNotices,
}: {
  me: WxUser;
  /** 传入 = 好友的朋友圈：界面同款，但名字/头像换好友、无发布与换封面入口 */
  owner?: { name: string; avatar: string | null } | null;
  /** 好友的联系人 ID（owner 非空时用于读/重置 peer 专属朋友圈封面） */
  peerId?: string;
  posts: WxMoment[];
  onBack: () => void;
  onCompose: () => void;
  onToggleLike: (id: string) => void;
  onComment: (id: string, text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: (id: string) => void;
  /** 删除自己的评论（好友朋友圈页不传） */
  onDeleteComment?: (postId: string, commentId: string) => void;
  /** 编辑动态正文（仅自己的动态；好友朋友圈页不传） */
  onEditRequest?: (post: WxMoment) => void;
  onToast: (m: string) => void;
  /** 互动消息未读数 + 最新一条消息人的头像（「1条新消息」气泡；好友朋友圈不显示） */
  noticeBadge: { count: number; avatar: string | null };
  /** 打开「与我的互动消息」页（气泡/铃铛入口） */
  onOpenNotices: () => void;
}) {
  const isMine = !owner;
  const shownName = owner?.name ?? me.name;
  const shownAvatar = owner ? owner.avatar : me.avatar;
  /** 「文字图片」卡片点击升级为真图：busy 的动态 id（卡片行「正在生成图片…」提示 + 防重入，与旧口径一致） */
  const [upgradingCardId, setUpgradingCardId] = useState<string | null>(null);
  /** A1/A2「生成图片」弹层（微信朋友圈同款小弹层）：upgrade = 文字图片卡片升级 / regen = 升级图重新生成 */
  const [genSheet, setGenSheet] = useState<null | { mode: 'upgrade' | 'regen'; postId: string; desc: string }>(null);
  const [genSheetBusy, setGenSheetBusy] = useState(false);
  const [genSheetError, setGenSheetError] = useState('');
  /** A1 描述可改升级：点击文字图片卡片打开「生成图片」弹层（预填卡片文字，可改），确认后才真正生图 */
  const handleUpgradeCard = (post: WxMoment) => {
    if (upgradingCardId) return; // 保留原 busy 防重入
    setGenSheet({ mode: 'upgrade', postId: post.id, desc: post.textCard ?? '' });
  };
  /** A1/A2 弹层确认：按 mode 调引擎升级/重新生成；成功关弹层 + toast（列表由引擎广播
   *  moments-changed → 宿主 reloadMoments 自动刷新）；失败留在弹层显示 error（可改后重试） */
  const submitMomentGen = async (descInput: string) => {
    if (!genSheet || genSheetBusy) return;
    const desc = descInput.trim().slice(0, 400); // 提交时 trim + 截 400（与聊天端同口径）
    setGenSheetBusy(true);
    setGenSheetError('');
    if (genSheet.mode === 'upgrade') setUpgradingCardId(genSheet.postId);
    try {
      const r =
        genSheet.mode === 'upgrade'
          ? await upgradeMomentTextCard('wx', genSheet.postId, me.name, desc || undefined) // 描述留空 → 引擎回落卡片文字
          : await regenerateMomentImage('wx', genSheet.postId, me.name, desc); // 描述留空 → 引擎回落上次描述
      if (r.ok) {
        setGenSheet(null);
        onToast(genSheet.mode === 'upgrade' ? '已生成照片，卡片已换成真图' : '已重新生成');
      } else {
        setGenSheetError(r.error || '生成失败，请稍后再试');
      }
    } catch (e) {
      setGenSheetError(e instanceof Error ? e.message : '生成失败，请稍后再试');
    } finally {
      setUpgradingCardId(null);
      setGenSheetBusy(false);
    }
  };
  const [menuId, setMenuId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /** 封面（本地 IndexedDB settings 存 data URL；迁移时从服务端一次性搬入） */
  const [cover, setCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  /** 47-b peer 朋友圈封面专属文件 input 引用（与自己的 coverRef 分开避免 onChange 混淆） */
  const peerCoverRef = useRef<HTMLInputElement>(null);

  // 启动读取本地封面（自己的朋友圈用 getWxBg('moments')；好友的用 getPeerBg('wx', peerId)）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (isMine) {
          const bg = await getWxBg('moments');
          if (alive && bg) setCover(bg.data);
        } else if (peerId) {
          const bg = await getPeerBg('wx', peerId);
          if (alive && bg) setCover(bg);
        }
      } catch {
        // 忽略，用默认封面
      }
    })();
    return () => {
      alive = false;
    };
  }, [isMine, peerId]);

  /** 好友朋友圈「恢复默认封面」：清掉 peer 专属背景 → 刷新 cover state */
  const resetPeerCover = async () => {
    if (!peerId) return;
    if (!window.confirm('确定恢复该好友的默认朋友圈封面？')) return;
    setCoverBusy(true);
    try {
      await removePeerBg('wx', peerId);
      setCover(null);
      onToast('已恢复默认封面');
    } catch {
      onToast('恢复失败');
    } finally {
      setCoverBusy(false);
    }
  };

  /** 从手机相册选图换封面：压缩 → 存本地 IndexedDB → 立即生效 */
  const pickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCoverBusy(true);
    try {
      const dataUrl = await readImageFile(file, 1280);
      const rec = await setWxBg('moments', dataUrl);
      setCover(rec.data);
      onToast('封面已更换');
    } catch (e) {
      onToast(e instanceof Error ? e.message : '封面保存失败');
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = '';
    }
  };

  /** 47-b 进他朋友圈点击封面上传：压缩 → setPeerBg('wx', peerId) → 刷新 cover state → toast。
   *  新需求取代了 chat-settings 的「恢复默认朋友圈封面」入口（恢复默认按钮仍保留在顶部右侧）。 */
  const pickPeerCover = async (files: FileList | null) => {
    if (!peerId) return;
    const file = files?.[0];
    if (!file) return;
    setCoverBusy(true);
    try {
      const dataUrl = await readImageFile(file, 1280);
      await setPeerBg('wx', peerId, dataUrl);
      setCover(dataUrl);
      onToast(`已为${shownName}更换朋友圈封面`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : '封面保存失败');
    } finally {
      setCoverBusy(false);
      if (peerCoverRef.current) peerCoverRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 滚动容器：封面 + 动态列表（封面随内容滚动，同微信） */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="wx-moments-list"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 230)}
      >
        {/* 封面：自定义上传图（无则默认风景照）+ 底部渐晕；点击封面图直接换（从手机上传，永久保存）。
         *  47-b：!isMine（进他朋友圈）也支持点击封面图上传换封面（新需求，替代 chat-settings 的「恢复默认朋友圈封面」入口） */}
        <div className="relative h-[300px]">
          {isMine ? (
            <button
              type="button"
              data-testid="wx-cover-change"
              aria-label="更换封面"
              title="点击更换封面"
              onClick={() => coverRef.current?.click()}
              disabled={coverBusy}
              className="absolute inset-0 block h-full w-full cursor-pointer disabled:cursor-default"
            >
              <img
                src={cover ?? '/wx/moments-cover.png'}
                alt="朋友圈封面，点击可更换"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
          ) : (
            <button
              type="button"
              data-testid="wx-moments-peer-cover-change"
              aria-label={`更换${shownName}的朋友圈封面`}
              title="点击上传封面"
              onClick={() => peerCoverRef.current?.click()}
              disabled={coverBusy || !peerId}
              className="absolute inset-0 block h-full w-full cursor-pointer disabled:cursor-default"
            >
              <img
                src={cover ?? '/wx/moments-cover.png'}
                alt={`${shownName}的朋友圈封面，点击可更换`}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {/* 47-b 视觉提示徽标：左上角相机图标 + 「点击更换」文案，让用户知道封面可点击上传。
               *  pointer-events-none 让点击穿透到 button 本身触发文件选择 */}
              {peerId && (
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 backdrop-blur">
                  <Camera className="h-4 w-4 text-white" strokeWidth={1.8} />
                  <span className="text-[11px] text-white">点击更换</span>
                </div>
              )}
            </button>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent"
            aria-hidden="true"
          />
          {/* 昵称 + 头像：微信同款，头像一半探出封面下沿 */}
          <div className="absolute -bottom-[30px] right-4 flex items-end gap-3">
            <span className="pb-2 text-[17px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {shownName}
            </span>
            <span className="block rounded-[8px] shadow-lg ring-[2.5px] ring-white">
              <WxAvatar src={shownAvatar} alt={shownName} size={68} />
            </span>
          </div>
        </div>

        {/* 「1条新消息」气泡（微信同款深色胶囊：最新互动人头像 + 条数；点开互动消息页并全部已读）。
            放在封面之下、动态列表之前，与真机一致 */}
        {isMine && noticeBadge.count > 0 && (
          <div className="flex justify-center pb-1 pt-10">
            <button
              type="button"
              data-testid="wx-moments-pill"
              aria-label={`${noticeBadge.count}条新消息`}
              onClick={onOpenNotices}
              className="flex items-center gap-2.5 rounded-[4px] bg-black/70 px-3 py-2 text-white shadow-md backdrop-blur active:bg-black/80 dark:bg-white/20"
            >
              <WxAvatar src={noticeBadge.avatar} alt="" size={26} />
              <span className="text-[14px]">{noticeBadge.count}条新消息</span>
            </button>
          </div>
        )}

        {posts.length === 0 ? (
          <div className="flex flex-col items-center pt-[88px] text-black/35 dark:text-white/35">
            <Camera className="h-9 w-9" strokeWidth={1.2} />
            <p className="mt-3 text-[14px]">{owner ? 'TA 还没有发过动态' : '还没有动态'}</p>
            {!owner && <p className="mt-1 text-[12.5px]">点右上角相机，发布第一条朋友圈吧</p>}
          </div>
        ) : (
          <div className="pt-[40px]">
            {posts.map((p) => (
              <MomentRow
                key={p.id}
                post={p}
                meName={me.name}
                menuOpen={menuId === p.id}
                onToggleMenu={() => setMenuId(menuId === p.id ? null : p.id)}
                onToggleLike={() => {
                  onToggleLike(p.id);
                  setMenuId(null);
                }}
                onComment={(text, reply) => onComment(p.id, text, reply)}
                onDelete={() => {
                  onDelete(p.id);
                  setMenuId(null);
                }}
                onDeleteComment={onDeleteComment ? (commentId) => onDeleteComment(p.id, commentId) : undefined}
                onEditRequest={onEditRequest ? () => onEditRequest(p) : undefined}
                onUpgradeCard={p.textCard ? () => void handleUpgradeCard(p) : undefined}
                onRegenImage={
                  // A2 重新生成入口：仅引擎升级过的图（textCardUpgraded === true）有；用户手动发的图无此入口
                  p.textCardUpgraded === true && p.images.length > 0
                    ? () => setGenSheet({ mode: 'regen', postId: p.id, desc: p.textCardDesc ?? '' })
                    : undefined
                }
                cardBusy={upgradingCardId === p.id}
              />
            ))}
            <p className="py-6 text-center text-[12px] text-black/25 dark:text-white/25">没有更多了</p>
          </div>
        )}
        {isMine && (
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickCover(e.target.files)}
          />
        )}
        {/* 47-b 进他朋友圈点击封面上传：peer 专属文件 input（与 coverRef 分开，避免 onChange 混淆）。
         *  无 peerId 时（owner 但无 peerId 的兜底场景）不渲染，按钮 disabled 已保险 */}
        {!isMine && peerId && (
          <input
            ref={peerCoverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickPeerCover(e.target.files)}
          />
        )}
      </div>

      {/* 顶部导航（悬浮在封面上）：滚过封面后切换为白底黑字并显示「朋友圈」标题
          wx-moments-nav：朋友圈顶部导航锚点（自定义 CSS 示例模板可改导航底色） */}
      <div
        className={`wx-moments-nav absolute inset-x-0 top-0 z-10 pt-[54px] transition-colors duration-200 ${
          scrolled
            ? 'bg-white/95 shadow-[0_0.5px_0_rgba(0,0,0,0.1)] backdrop-blur dark:bg-[#111111]/95 dark:shadow-[0_0.5px_0_rgba(255,255,255,0.12)]'
            : ''
        }`}
      >
        <div className="flex h-11 items-center justify-between px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-moments-back"
            onClick={onBack}
            className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
              scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
            }`}
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <span className={`text-[17px] font-medium ${scrolled ? '' : 'hidden'}`}>朋友圈</span>
          {isMine ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="互动消息"
                title="与我的互动消息"
                data-testid="wx-moments-notices"
                onClick={onOpenNotices}
                className={`relative rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                  scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                }`}
              >
                <Bell className="h-[21px] w-[21px]" strokeWidth={1.8} />
                {noticeBadge.count > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#FA5151]" aria-hidden="true" />}
              </button>
              <button
                type="button"
                aria-label="发布朋友圈"
                data-testid="wx-moments-compose"
                onClick={onCompose}
                className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                  scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                }`}
              >
                <Camera className="h-[22px] w-[22px]" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center justify-end gap-1" style={{ minWidth: 60 }}>
              {peerId && cover && (
                <button
                  type="button"
                  aria-label="恢复默认封面"
                  title="恢复默认封面"
                  data-testid="wx-moments-reset-cover"
                  onClick={() => void resetPeerCover()}
                  disabled={coverBusy}
                  className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                    scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                  }`}
                >
                  <Undo2 className="h-[20px] w-[20px]" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* A1/A2「生成图片」弹层：文字图片卡片升级真图 / 升级图重新生成（同款弹层，描述预填可改） */}
      {genSheet && (
        <MomentImageGenSheet
          title={genSheet.mode === 'upgrade' ? '生成图片' : '重新生成图片'}
          initialDesc={genSheet.desc}
          busy={genSheetBusy}
          error={genSheetError}
          onClose={() => (genSheetBusy ? undefined : setGenSheet(null))}
          onSubmit={(d) => void submitMomentGen(d)}
        />
      )}
    </div>
  );
}

// ---------------- 发布朋友圈页 ----------------

export function ComposeMomentsPage({
  onCancel,
  onPublish,
  onToast,
}: {
  onCancel: () => void;
  /** 发表：正文 + 配图 + 位置名（可选；入库/互动队列由动态引擎统一处理） */
  onPublish: (text: string, images: string[], location?: string) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [showLoc, setShowLoc] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const canPost = (text.trim().length > 0 || images.length > 0) && !busy;

  const pick = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setErr('');
    try {
      const room = 9 - images.length;
      const list = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const f of list) urls.push(await readImageFile(f));
      setImages((prev) => [...prev, ...urls].slice(0, 9));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片读取失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：取消 / 发表 */}
      <div className="pt-[54px]">
        <div className="flex h-12 items-center justify-between px-4">
          <button
            type="button"
            data-testid="wx-compose-cancel"
            onClick={onCancel}
            className="text-[16px] active:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-compose-submit"
            disabled={!canPost}
            onClick={() => onPublish(text.trim(), images, location.trim() || undefined)}
            className={`rounded-[5px] px-4 py-1.5 text-[15px] font-medium transition-colors ${
              canPost
                ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
                : 'bg-black/[0.06] text-black/25 dark:bg-white/10 dark:text-white/30'
            }`}
          >
            发表
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <textarea
          ref={textRef}
          data-testid="wx-compose-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="这一刻的想法..."
          rows={5}
          autoFocus
          className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
        />

        {/* 图片选择网格 */}
        <div className="mt-2 grid max-w-[268px] grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative aspect-square">
              <img src={src} alt={`已选图片${i + 1}`} className="h-full w-full rounded-[4px] object-cover" />
              <button
                type="button"
                aria-label={`移除图片${i + 1}`}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {images.length < 9 && (
            <button
              type="button"
              aria-label="添加图片"
              data-testid="wx-compose-add-img"
              onClick={() => fileRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-[4px] border border-dashed border-black/15 bg-[#F7F7F7] text-black/30 active:bg-black/10 dark:border-white/15 dark:bg-[#1E1E1E] dark:text-white/30"
            >
              {busy ? (
                <Loader2 className="h-7 w-7 animate-spin" strokeWidth={1.6} />
              ) : (
                <Plus className="h-8 w-8" strokeWidth={1.1} />
              )}
            </button>
          )}
        </div>
        {busy && <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">正在处理图片…</p>}
        {err && <p className="mt-2 text-[13px] text-red-500">{err}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void pick(e.target.files)}
        />
      </div>

      {/* 底部：表情面板 + 所在位置 / 表情 / 提醒谁看 / 谁可以看（预留底部横杠安全区） */}
      <div className="shrink-0 border-t border-black/[0.06] pb-[14px] dark:border-white/[0.08]">
        {showEmoji && (
          <div className="px-3 pt-2">
            <MomentsEmojiPanel
              onPick={(e) => insertEmojiAtCursor(textRef, text, e, setText)}
              onClose={() => setShowEmoji(false)}
            />
          </div>
        )}
        {(
          [
            ['所在位置', location, 'loc', <MapPin key="l" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['表情', '', 'emoji', <Smile key="e" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['提醒谁看', '', 'todo', <AtSign key="a" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['谁可以看', '公开', 'todo', <User key="u" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
          ] as Array<[string, string, string, React.ReactNode]>
        ).map(([label, value, act, icon], i) => (
          <div key={label} className="relative">
            {i > 0 && <span className="absolute left-0 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
            <button
              type="button"
              data-testid={`wx-compose-${label}`}
              onClick={() => {
                if (act === 'loc') setShowLoc(true);
                else if (act === 'emoji') setShowEmoji((v) => !v);
                else if (label === '谁可以看') onToast('谁可以看：公开');
                else onToast(`「${label}」暂未开放`);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="text-black/55 dark:text-white/55">{icon}</span>
              <span className="min-w-0 flex-1 text-[15.5px]">{label}</span>
              {value && act === 'loc' && (
                <>
                  <span className="max-w-[160px] truncate text-[15px] text-black/45 dark:text-white/45" data-testid="wx-compose-location-value">{value}</span>
                  <span
                    role="button"
                    aria-label="清除位置"
                    data-testid="wx-compose-location-clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation('');
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/25 text-white active:bg-black/40 dark:bg-white/25"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </span>
                </>
              )}
              {!value && <ChevronRight className="h-4 w-4 shrink-0 text-black/20 dark:text-white/20" strokeWidth={2} />}
            </button>
          </div>
        ))}
      </div>

      {/* 位置选择（复用聊天发送位置的内置地点/自定义位置页；选中即回填位置名） */}
      {showLoc && (
        <div className="absolute inset-0 z-30">
          <LocationPickerPage
            onClose={() => setShowLoc(false)}
            onSend={(name) => {
              setLocation(name);
              setShowLoc(false);
            }}
            onToast={onToast}
          />
        </div>
      )}
    </div>
  );
}
