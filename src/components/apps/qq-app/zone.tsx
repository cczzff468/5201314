'use client';

/** QQ空间动态流 + 写说说页 —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BookOpen, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, LayoutGrid, Loader2, MapPin, MessageCircle, MessageSquare, Settings, Share2, Smile, Sparkles, Star, Tag, ThumbsUp, X } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { addCharMomentPost, addUserMomentComment, addUserMomentPost, aiPostMoment, deleteMomentComment, deleteMomentPost, enqueuePostInteractions, // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage, repairLegacyMomentData, subscribeMomentsChanged, toggleUserMomentLike, updateMomentPostContent, upgradeMomentTextCard } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { AskPostSheet, BilingualTranslation, CommentDeleteDialog, EditPostDialog, MomentAutoCfgSheet, MomentsEmojiPanel, PostMoreMenu, insertEmojiAtCursor, momentFriendsOf } from '../moments-shared';
import { getMomentsSettings } from '@/lib/ios/moments-settings';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { TextCardBubble } from '@/components/apps/text-card-bubble';
import { contactByRef, displayNameOf, liveAvatarOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { isFriendDeleted } from '@/lib/ios/friend-state';

import { LocationPickerPage } from './cards';
import { LS_ZONE_LIKES, QQUser, QQ_BLUE, SEED_DEFAULT_LIKE, ZONE_SEEDS, ZoneComment, ZonePost, compressImageFile, loadZoneComments, loadZonePosts } from './core';
import { QqAvatar } from './widgets';

// ---------------- QQ空间动态流（动态 tab - 空间动态） ----------------

/** #41c TA 的空间首访播种模板：新好友空间一条动态都没有时补 3 条通用模板说说（
 *  writeMemory=false 不入记忆；与角色人设无关的中性口吻、无 emoji，对照微信 openFriendMoments 的示例动态） */
export const ZONE_OWNER_POST_TEMPLATES: ReadonlyArray<{ text: string; agoMs: number }> = [
  { text: '今天天气不错，出门走了走，顺便买了杯咖啡', agoMs: 2 * 3_600_000 },
  { text: '忙了好一阵子，总算把手里的事情收尾了', agoMs: 26 * 3_600_000 },
  { text: '晚上早点睡，明天开始按计划做事', agoMs: 3 * 86_400_000 },
];

/** A1/A2 QQ空间「生成图片」弹层（iOS 风格底部小弹层，样式对齐转发弹层/聊天 qq-textcard-sheet：
 *  absolute 底部圆角 16 底板 + QQ 蓝 #0099FF 主按钮）：textarea 预填画面描述可改，
 *  主按钮「生成图片」（busy 转圈禁用），错误显示在弹层内（可改后重试）；busy 中不可关闭 */
export function ZoneImageGenSheet({
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
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={title} data-testid="qq-moment-imggen-sheet">
      <div className="rounded-t-[16px] bg-white p-4 pb-[max(18px,env(safe-area-inset-bottom))] dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">{title}</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid="qq-moment-imggen-close"
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
          data-testid="qq-moment-imggen-input"
          placeholder="画面描述（可修改后再生成）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] text-[#1F2329] outline-none placeholder:text-black/30 focus:border-[#0099FF]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="qq-moment-imggen-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="qq-moment-imggen-submit"
          onClick={() => onSubmit(desc)}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0099FF] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
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

export function ZonePage({
  me,
  contacts,
  onBack,
  onCompose,
  onToast,
  askOpen,
  setAskOpen,
  /** 传入 = 该好友的QQ空间（个人卡换成 TA；只显示 TA 发的动态；隐藏发布入口/让好友发一条） */
  owner,
  /** true = 只显示机主自己发的动态（个人资料页 QQ空间进入「我的空间动态」） */
  mineOnly,
  /** 互动消息未读数 + 最新一条消息人的头像（「1条新消息」气泡） */
  noticeBadge,
  /** 打开「空间消息」页（铃铛/气泡入口） */
  onOpenNotices,
}: {
  me: QQUser;
  /** 联系人列表（「让好友发一条」候选 + 平台好友过滤） */
  contacts: ContactRecord[];
  onBack: () => void;
  onCompose: () => void;
  onToast: (m: string) => void;
  /** 「让好友发一条」开关（lift 到 MainScreen，供「空间动态设置 → 立即发帖」复用） */
  askOpen: boolean;
  setAskOpen: (b: boolean) => void;
  owner?: ContactRecord;
  mineOnly?: boolean;
  noticeBadge: { count: number; avatar: string | null };
  onOpenNotices: () => void;
}) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const [userPosts, setUserPosts] = useState<ZonePost[]>(loadZonePosts);
  const [seedLiked, setSeedLiked] = useState<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = kvGet<Record<string, boolean>>(LS_ZONE_LIKES);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [commentsMap, setCommentsMap] = useState<Record<string, ZoneComment[]>>(loadZoneComments);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  /** 回复目标：评论 id + 名字（带 id 才能支持回复 AI 评论后 AI 再回复的多轮链） */
  const [replyTarget, setReplyTarget] = useState<Record<string, { id: string; name: string } | undefined>>({});
  const commentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** 「…」操作菜单 / 编辑说说 / 让好友发一条 / 自动发布设置 */
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<{ id: string; content: string } | null>(null);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  /** 「文字图片」卡片升级/升级图重新生成：busy 的动态 id（卡片行「正在生成图片…」提示 + 防重入，与旧口径一致） */
  const [upgradingCardId, setUpgradingCardId] = useState<string | null>(null);
  /** A1/A2「生成图片」弹层：upgrade = 文字图片卡片升级 / regen = 升级图重新生成（同款弹层，描述预填可改） */
  const [genSheet, setGenSheet] = useState<null | { mode: 'upgrade' | 'regen'; postId: string; desc: string }>(null);
  const [genSheetBusy, setGenSheetBusy] = useState(false);
  const [genSheetError, setGenSheetError] = useState('');
  /** A1 描述可改升级：点击文字图片卡片打开「生成图片」弹层（预填卡片文字，可改），确认后才真正生图 */
  const handleUpgradeCard = (post: ZonePost) => {
    if (upgradingCardId) return; // 保留原 busy 防重入
    setGenSheet({ mode: 'upgrade', postId: post.id, desc: post.textCard ?? '' });
  };
  /** A2 升级图重新生成（长按/右键）：弹层预填上次实际使用的画面描述（legacy 缺省回落空串） */
  const openRegenSheet = (post: ZonePost) => {
    setGenSheet({ mode: 'regen', postId: post.id, desc: post.textCardDesc ?? '' });
  };
  /** A1/A2 弹层确认：按 mode 调引擎升级/重新生成；成功关弹层 + toast（列表由引擎广播
   *  moments-changed → ZonePage 订阅自动刷新）；失败留在弹层显示 error（可改后重试） */
  const submitZoneGen = async (descInput: string) => {
    if (!genSheet || genSheetBusy) return;
    const desc = descInput.trim().slice(0, 400); // 提交时 trim + 截 400（与聊天端同口径）
    setGenSheetBusy(true);
    setGenSheetError('');
    if (genSheet.mode === 'upgrade') setUpgradingCardId(genSheet.postId);
    try {
      const r =
        genSheet.mode === 'upgrade'
          ? await upgradeMomentTextCard('qq', genSheet.postId, me.name, desc || undefined) // 描述留空 → 引擎回落卡片文字
          : await regenerateMomentImage('qq', genSheet.postId, me.name, desc); // 描述留空 → 引擎回落上次描述
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
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delComment, setDelComment] = useState<{ postId: string; commentId: string; author: string } | null>(null);
  /** 转发目标动态（转发弹层；转发 = 新说说（理由）+ 原动态摘要卡） */
  const [repostTarget, setRepostTarget] = useState<ZonePost | null>(null);
  const [repostDraft, setRepostDraft] = useState('');
  /** 朋友圈/空间动态设置缓存（mount 时读一次 kv，避免每次 render 重读）。
   *  feat-64：设置按平台独立（只读 QQ 空间这一份） */
  const [momentsSettings] = useState(() => getMomentsSettings('qq'));
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
  // 离开空间动态页时关闭「让好友发一条」弹层（防止 lift 状态在下次进页时残留）
  useEffect(() => () => setAskOpen(false), [setAskOpen]);

  /** 长按评论（480ms）→ 删除确认；移动超 10px 视为滚动取消 */
  const startCommentPress = (p: ZonePost, c: ZoneComment) => (e: React.PointerEvent) => {
    if (p.id.startsWith('seed-')) return; // 示例动态的评论不支持删除
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelComment({ postId: p.id, commentId: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  /** A2 升级图长按 → 打开「重新生成图片」弹层（复用评论长按同款计时器/移动取消/抑制 click 模式） */
  const startZoneImagePress = (post: ZonePost) => (e: React.PointerEvent) => {
    if (post.textCardUpgraded !== true) return; // 仅引擎升级过的图有入口；用户手动发的图无入口
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      openRegenSheet(post);
    }, 480);
  };
  const onZoneImagePointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  // 旧版遗留修复 + 订阅引擎刷新（AI 点赞/评论/新动态实时出现）
  useEffect(() => {
    repairLegacyMomentData();
    return subscribeMomentsChanged((platform) => {
      if (platform && platform !== 'qq') return;
      setUserPosts(loadZonePosts());
      setCommentsMap(loadZoneComments());
    });
  }, []);

  // #41c TA 的空间首访播种：该好友空间一条动态都没有时补 3 条通用模板说说（动态引擎写入、
  // writeMemory=false 不入记忆，与微信 openFriendMoments 同口径；有动态后不再补，删光后下次进页重播）
  useEffect(() => {
    if (!owner) return;
    const dn = displayNameOf(owner);
    if (loadZonePosts().some((p) => p.authorName === dn || p.authorName === owner.name)) return;
    const now = Date.now();
    for (const t of ZONE_OWNER_POST_TEMPLATES) {
      addCharMomentPost('qq', {
        peer: owner,
        userName: me.name,
        content: t.text,
        writeMemory: false,
        createdAt: now - t.agoMs,
      });
    }
    setUserPosts(loadZonePosts());
  }, [owner, me.name]);

  /** 动态过滤：TA 的空间（owner）→ 只看 TA 发的；我的空间（mineOnly）→ 只看我发的；默认全量。
   *  头像实时读取：动态只存身份引用（peerId），渲染时经 liveAvatarOf 实时取联系人当前头像
   *  （换头像立即同步；QQ/微信共用 liveAvatarOf；legacy 无 peerId 数据按名字兜底）。
   *  删好友门控：被删好友（qq 端 friend-del 状态）的动态隐藏（数据保留，加回后恢复） */
  const posts: ZonePost[] = useMemo(() => {
    const all = [...userPosts, ...ZONE_SEEDS];
    const scoped = owner
      ? all.filter((p) => p.authorName === displayNameOf(owner) || p.authorName === owner.name)
      : mineOnly
        ? all.filter((p) => p.authorName === me.name)
        : all.filter((p) => {
            const hit = contactByRef({ peerId: p.peerId, name: p.authorName }, contacts);
            return !(hit && hit.kind !== 'user' && isFriendDeleted('qq', hit.id));
          });
    // 自己发的动态（author='user'，peerId=null 仅名字归因）：改名/换头像后按机主联系人实时解析
    // 名字与头像——避免改名后旧帖回退到落库时的旧快照（与微信朋友圈同口径）
    const meOwner = contacts.find((c) => c.kind === 'user' && !c.altOf) ?? null;
    return scoped.map((p) =>
      p.author === 'user' && meOwner
        ? { ...p, authorName: displayNameOf(meOwner) || p.authorName, avatar: meOwner.avatar ?? p.avatar }
        : { ...p, avatar: liveAvatarOf(p.avatar, { peerId: p.peerId, name: p.authorName }, contacts, 'qq') }
    );
  }, [userPosts, owner, mineOnly, me.name, contacts]);

  /** 空间页头展示的用户（TA 的空间换头像/名字） */
  const shownUser = owner
    ? { name: displayNameOf(owner), avatar: owner.avatar }
    : { name: me.name, avatar: me.avatar };

  const addComment = (p: ZonePost) => {
    const t = (commentDrafts[p.id] ?? '').trim();
    if (!t) return;
    // 统一走动态引擎：回复 AI 的评论会自动排一条 AI 的再回复（多轮）；评论角色的动态会写入该角色记忆
    const rt = replyTarget[p.id];
    addUserMomentComment('qq', p.id, {
      userName: me.name,
      content: t,
      replyTo: rt ? { commentId: rt.id, name: rt.name } : undefined,
    });
    setCommentDrafts((d) => ({ ...d, [p.id]: '' }));
    setReplyTarget((r) => ({ ...r, [p.id]: undefined }));
  };

  const likedOf = (p: ZonePost): boolean =>
    p.id.startsWith('seed-') ? (seedLiked[p.id] ?? SEED_DEFAULT_LIKE[p.id] ?? false) : p.likedBy.includes(me.name);

  const namesOf = (p: ZonePost): string[] => {
    if (p.id.startsWith('seed-')) {
      const base = p.likedBy.map((n) => (n === 'ME' ? me.name : n)).filter((n) => n !== me.name);
      return likedOf(p) ? [me.name, ...base] : base;
    }
    return p.likedBy;
  };

  const toggleLike = (p: ZonePost) => {
    if (p.id.startsWith('seed-')) {
      const next = { ...seedLiked, [p.id]: !likedOf(p) };
      setSeedLiked(next);
      try {
        kvSet(LS_ZONE_LIKES, next);
      } catch {
        // 忽略
      }
      return;
    }
    // 统一走动态引擎（写入点赞名，评论区的 AI 可见）
    toggleUserMomentLike('qq', p.id, me.name);
  };

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = async (c: ContactRecord) => {
    setAskBusyId(c.id);
    try {
      await aiPostMoment({ apiConfig, platform: 'qq', peer: c, userName: me.name });
      onToast(`已让「${displayNameOf(c)}」发了一条动态`);
      setAskOpen(false);
    } catch (e) {
      onToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
    } finally {
      setAskBusyId(null);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-[#111214]">
      {/* 全屏：整个页面（含顶部渐变区）在同一滚动容器里，头部随内容一起滚走 */}
      <div className="flex-1 overflow-y-auto" data-testid="qq-zone-feed">
      {/* 顶部渐变区：导航 + 个人卡 + 宫格 + 发布框（随页面滚动） */}
      <div className="bg-gradient-to-b from-[#D8E4F8] via-[#E9EEFA] to-white pb-3 pt-[54px] dark:from-[#242B3E] dark:via-[#1D2331] dark:to-[#111214]">
        <div className="flex items-center gap-2 px-3">
          <button
            type="button"
            aria-label="返回"
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="空间消息"
            data-testid="qq-zone-bell"
            onClick={onOpenNotices}
            className="relative ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
            {noticeBadge.count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#FA5151]" aria-hidden="true" />}
          </button>
        </div>

        {/* 个人卡（TA 的空间时换成 TA 的头像/名字） */}
        <div className="mt-3 flex items-center gap-3 px-4">
          <QqAvatar src={shownUser.avatar} alt={shownUser.name} size={60} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[19px] font-semibold">{shownUser.name}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[13px] text-black/50 dark:text-white/50">
              <Eye className="h-4 w-4" aria-hidden="true" />
              总量 <span className="font-semibold">195</span> · <span className="font-semibold">+2</span>
            </div>
          </div>
        </div>

        {/* 宫格：说说/日志/相册/留言/更多（说说 → 写说说页）；TA 的空间隐藏发布类入口 */}
        {!owner && (
        <div className="mt-3 flex px-1">
          {[
            { label: '说说', icon: <MessageSquare className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: onCompose, testid: 'qq-zone-shuoshuo' },
            { label: '日志', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('日志暂未开放'), testid: undefined },
            { label: '相册', icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('相册暂未开放'), testid: undefined },
            { label: '留言', icon: <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('留言暂未开放'), testid: undefined },
            { label: '更多', icon: <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('更多暂未开放'), testid: undefined },
          ].map((g) => (
            <button
              key={g.label}
              type="button"
              data-testid={g.testid}
              onClick={g.fn}
              className="flex flex-1 flex-col items-center gap-1 text-[#3E7BCC] active:opacity-60 dark:text-[#6FA0DE]"
            >
              {g.icon}
              <span className="text-[12px] text-black/60 dark:text-white/60">{g.label}</span>
            </button>
          ))}
        </div>
        )}

        {/* 分享新鲜事：点击进入「写说说」页（TA 的空间不显示） */}
        {!owner && (
        <div className="mx-4 mt-3">
          <button
            type="button"
            data-testid="qq-zone-input"
            onClick={onCompose}
            className="w-full rounded-[14px] border border-black/10 bg-white/60 px-3 py-2.5 text-left backdrop-blur active:bg-white/85 dark:border-white/10 dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
          >
            <span className="block text-[15px] text-black/30 dark:text-white/30">分享新鲜事…</span>
            <span className="mt-2 flex items-center text-black/45 dark:text-white/45">
              <ImageIcon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
              <span className="mx-2.5 h-4 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
              <Star className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            </span>
          </button>
        </div>
        )}
      </div>

      {/* 「1条新消息」气泡（QQ 同款白色胶囊：头像 + 条数 + 箭头；点开空间消息页并全部已读） */}
      {!owner && !mineOnly && noticeBadge.count > 0 && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            data-testid="qq-zone-pill"
            aria-label={`${noticeBadge.count}条新消息`}
            onClick={onOpenNotices}
            className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-[0_1px_5px_rgba(0,0,0,0.08)] active:bg-black/[0.04] dark:bg-[#2A2C33]"
          >
            <QqAvatar src={noticeBadge.avatar} alt="" size={24} />
            <span className="text-[14px]">{noticeBadge.count}条新消息</span>
            <ChevronRight className="h-4 w-4 text-black/35 dark:text-white/35" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 动态流（与头部同一滚动容器） */}
        {posts.map((p) => {
          const liked = likedOf(p);
          const names = namesOf(p);
          const rt = replyTarget[p.id];
          return (
            <div key={p.id} className="border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06]">
              <div className="flex items-start gap-3">
                <QqAvatar src={p.avatar} alt={p.authorName} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[16px] font-semibold text-[#4A78B8] dark:text-[#7FA8D9]">{p.authorName}</span>
                    <button
                      type="button"
                      aria-label="更多操作"
                      data-testid={`qq-zone-more-${p.id}`}
                      onClick={() => setMenuPostId(menuPostId === p.id ? null : p.id)}
                      className="shrink-0 px-1 text-[18px] leading-none text-black/40 active:opacity-60 dark:text-white/40"
                    >
                      …
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-[1.55]">{p.content}</p>
                  <BilingualTranslation zh={p.contentZh ?? ''} foldByDefault={momentsSettings.foldChineseTranslation} />

                  {/* 转发引用卡：原动态摘要（作者 + 内容 + 最多 3 张配图快照） */}
                  {p.repostOf && (
                    <div className="mt-2 rounded-[10px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.05]" data-testid={`qq-zone-repost-${p.id}`}>
                      <p className="text-[14px] leading-[1.5]">
                        <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{p.repostOf.authorName}</span>
                        <span className="text-black/75 dark:text-white/75">：{p.repostOf.content}</span>
                      </p>
                      {p.repostOf.images.length > 0 && (
                        <div className="mt-2 flex gap-1.5">
                          {p.repostOf.images.slice(0, 3).map((src, i) => (
                            <img key={i} src={src} alt="转发配图" loading="lazy" decoding="async" className="h-16 w-16 rounded-[6px] object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 「文字图片」卡片（AI 配图降级产物）：韩系简约卡片直接当配图，点击打开「生成图片」弹层（描述可改）升级为真图 */}
                  {p.textCard && !(p.images && p.images.length > 0) && (
                    <div className="mt-2" data-testid={`qq-zone-textcard-${p.id}`}>
                      <TextCardBubble
                        text={p.textCard}
                        signedBy={p.authorName}
                        variant="qq"
                        onClick={() => handleUpgradeCard(p)}
                      />
                      {upgradingCardId === p.id && (
                        <p className="mt-1 text-[12px] text-black/35 dark:text-white/35">正在生成图片…</p>
                      )}
                    </div>
                  )}

                  {p.images && p.images.length > 0 && (
                    <div className={`mt-2 grid gap-1.5 ${p.images.length === 1 ? 'max-w-[240px]' : 'grid-cols-3'}`}>
                      {p.images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="动态配图"
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full rounded-[8px] object-cover"
                          {...(p.textCardUpgraded === true
                            ? {
                                // A2 长按升级图 →「重新生成图片」弹层（桌面端右键同入口；仅引擎升级过的图有入口）
                                onPointerDown: startZoneImagePress(p),
                                onPointerMove: onZoneImagePointerMove,
                                onPointerUp: clearPress,
                                onPointerLeave: clearPress,
                                onPointerCancel: clearPress,
                                onContextMenu: (e: React.MouseEvent) => {
                                  e.preventDefault();
                                  openRegenSheet(p);
                                },
                              }
                            : {})}
                        />
                      ))}
                    </div>
                  )}

                  {/* 位置行（发说说时选了「所在位置」才显示） */}
                  {p.location && (
                    <p className="mt-1.5 flex items-center gap-1 text-[13px] text-[#4A78B8] dark:text-[#7FA8D9]" data-testid={`qq-zone-location-${p.id}`}>
                      <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                      <span className="truncate">{p.location}</span>
                    </p>
                  )}

                  <div className="mt-2 flex items-center">
                    <span className="text-[12px] text-black/35 dark:text-white/35">{p.time}</span>
                    <div className="ml-auto flex items-center gap-7 text-black/55 dark:text-white/55">
                      <button
                        type="button"
                        aria-label={liked ? '取消赞' : '赞'}
                        data-testid={`qq-zone-like-${p.id}`}
                        onClick={() => toggleLike(p)}
                        className={`active:opacity-60 ${liked ? 'text-[#1E6FFF] dark:text-[#4AA3FF]' : ''}`}
                      >
                        <ThumbsUp className={`h-[18px] w-[18px] ${liked ? 'fill-current' : ''}`} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="评论"
                        data-testid={`qq-zone-comment-btn-${p.id}`}
                        onClick={() => commentInputRefs.current[p.id]?.focus()}
                        className="active:opacity-60"
                      >
                        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="转发"
                        data-testid={`qq-zone-repost-btn-${p.id}`}
                        onClick={() => {
                          if (p.repostOf) {
                            onToast('转发动态不可再转发');
                            return;
                          }
                          setRepostDraft('');
                          setRepostTarget(p);
                        }}
                        className="active:opacity-60"
                      >
                        <Share2 className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {names.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[#4A78B8] dark:text-[#7FA8D9]">
                      <ThumbsUp className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      {names.join('、')} 赞了
                    </div>
                  )}

                  {(commentsMap[p.id]?.length ?? 0) > 0 && (
                    <div
                      className="mt-2 space-y-1.5 rounded-[10px] bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                      data-testid={`qq-zone-comments-${p.id}`}
                    >
                      {(commentsMap[p.id] ?? []).map((c) => (
                        <div key={c.id} className="text-[14px] leading-[1.5]">
                          <div className="flex items-start gap-2">
                            <p
                              className="min-w-0 flex-1 active:opacity-70"
                              title="点击回复，长按删除"
                              onPointerDown={startCommentPress(p, c)}
                              onPointerUp={clearPress}
                              onPointerLeave={clearPress}
                              onPointerCancel={clearPress}
                              onPointerMove={onCommentPointerMove}
                              onClick={() => {
                                // 长按后拦截紧随的 click（不设置回复目标）
                                if (suppressClickRef.current) {
                                  suppressClickRef.current = false;
                                  return;
                                }
                                setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                                commentInputRefs.current[p.id]?.focus();
                              }}
                            >
                              <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.author}</span>
                              {c.replyTo && (
                                <>
                                  <span className="mx-0.5 text-black/40 dark:text-white/40">回复</span>
                                  <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.replyTo}</span>
                                </>
                              )}
                              <span className="text-black/80 dark:text-white/80">：{c.content}</span>
                              <span className="ml-2 text-[11px] text-black/30 dark:text-white/30">{c.time}</span>
                            </p>
                            <button
                              type="button"
                              aria-label={`回复${c.author}的评论`}
                              data-testid={`qq-zone-reply-${p.id}-${c.id}`}
                              onClick={() => {
                                setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                                commentInputRefs.current[p.id]?.focus();
                              }}
                              className="shrink-0 pt-0.5 text-[12px] text-black/40 active:opacity-60 dark:text-white/40"
                            >
                              回复
                            </button>
                          </div>
                          <BilingualTranslation zh={c.contentZh ?? ''} foldByDefault={momentsSettings.foldChineseTranslation} />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                    <QqAvatar src={me.avatar} alt={me.name} size={22} />
                    {rt && (
                      <button
                        type="button"
                        aria-label={`取消回复${rt.name}`}
                        data-testid={`qq-zone-reply-cancel-${p.id}`}
                        onClick={() => setReplyTarget((r) => ({ ...r, [p.id]: undefined }))}
                        className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
                      >
                        回复{rt.name}
                        <X className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    )}
                    <input
                      ref={(el) => {
                        commentInputRefs.current[p.id] = el;
                      }}
                      data-testid={`qq-zone-comment-input-${p.id}`}
                      aria-label={`评论${p.authorName}的动态`}
                      placeholder={rt ? `回复 ${rt.name}：` : '说点什么吧...'}
                      value={commentDrafts[p.id] ?? ''}
                      onChange={(e) => setCommentDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addComment(p);
                      }}
                      className="h-5 w-full bg-transparent text-[13px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
                    />
                    {(commentDrafts[p.id] ?? '').trim() && (
                      <button
                        type="button"
                        aria-label="发送评论"
                        data-testid={`qq-zone-comment-send-${p.id}`}
                        onClick={() => addComment(p)}
                        className="shrink-0 text-[13px] font-medium text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                      >
                        发送
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {posts.length === 0 && <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">还没有动态</p>}
      </div>

      {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑/删除说说（六.4）；TA 的空间不显示 */}
      {askOpen && !owner && (
        <AskPostSheet
          title="让好友发一条"
          friends={momentFriendsOf(contacts, 'qq')}
          busyId={askBusyId}
          onClose={() => setAskOpen(false)}
          onAsk={(c) => void askMomentPost(c)}
          onOpenCfg={(c) => setCfgPeer(c)}
          renderAvatar={(c, size) => <QqAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
        />
      )}
      {cfgPeer && (
        <MomentAutoCfgSheet
          contact={cfgPeer}
          platform="qq"
          platformLabel="QQ动态"
          onClose={() => setCfgPeer(null)}
          onToast={onToast}
        />
      )}
      {menuPostId && (
        <PostMoreMenu
          onEdit={() => {
            const hit = posts.find((x) => x.id === menuPostId);
            if (hit) setEditingPost({ id: hit.id, content: hit.content });
            setMenuPostId(null);
          }}
          onDelete={() => {
            deleteMomentPost('qq', menuPostId, me.name);
            setMenuPostId(null);
            onToast('已删除动态');
          }}
          onClose={() => setMenuPostId(null)}
        />
      )}
      {editingPost && (
        <EditPostDialog
          key={editingPost.id}
          initial={editingPost.content}
          busy={false}
          onCancel={() => setEditingPost(null)}
          onSave={(text) => {
            if (!updateMomentPostContent('qq', editingPost.id, me.name, text)) onToast('动态内容不能为空');
            setEditingPost(null);
          }}
        />
      )}
      {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
      {delComment && (
        <CommentDeleteDialog
          author={delComment.author}
          onCancel={() => setDelComment(null)}
          onDelete={() => {
            deleteMomentComment('qq', delComment.postId, delComment.commentId, me.name);
            setDelComment(null);
          }}
        />
      )}
      {/* 转发弹层：理由输入 + 原动态预览；发表后进我的空间（好友会收到转发互动） */}
      {repostTarget && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="转发到我的空间" onClick={() => setRepostTarget(null)}>
          <div className="rounded-t-[16px] bg-white p-4 pb-8 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <button type="button" data-testid="qq-repost-cancel" onClick={() => setRepostTarget(null)} className="text-[15px] text-black/55 active:opacity-60 dark:text-white/55">
                取消
              </button>
              <span className="text-[15.5px] font-medium">转发到我的空间</span>
              <button
                type="button"
                data-testid="qq-repost-confirm"
                onClick={() => {
                  // 【fix3-d-4】原作者归属优先取引擎统一视图的显式 author（post.id 同源于 qq-zone-posts 键，
                  // id 精确匹配不误判）；引擎查不到（刚落库竞态等）才回退旧的按名字推断
                  const enginePost = listMomentPosts('qq', me.name, contacts).find((p) => p.id === repostTarget.id);
                  const post = addUserMomentPost('qq', {
                    userName: me.name,
                    avatar: me.avatar,
                    content: repostDraft.trim() || '转发动态',
                    repostOf: {
                      postId: repostTarget.id,
                      author: enginePost?.author ?? (repostTarget.authorName === me.name ? 'user' : 'char'),
                      authorName: repostTarget.authorName,
                      content: repostTarget.content.slice(0, 80),
                      images: (repostTarget.images ?? []).slice(0, 3),
                    },
                  });
                  // 转发的动态与原创说说同口径排 AI 互动队列：好友才会赞/评/转发这条转发
                  //（此前漏入队，好友永远不会互动用户的转发动态）
                  enqueuePostInteractions('qq', post.id);
                  setRepostTarget(null);
                  onToast('已转发到空间');
                }}
                className="h-9 rounded-[10px] bg-[#1B9FF0] px-4 text-[14px] font-medium text-white active:brightness-95"
              >
                发表
              </button>
            </div>
            <input
              value={repostDraft}
              onChange={(e) => setRepostDraft(e.target.value.slice(0, 200))}
              placeholder="说点什么吧…（可不填）"
              aria-label="转发理由"
              data-testid="qq-repost-input"
              autoFocus
              className="mt-4 h-10 w-full rounded-full bg-black/[0.04] px-4 text-[14.5px] outline-none placeholder:text-black/30 focus:bg-black/[0.06] dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-white/[0.1]"
            />
            <div className="mt-3 rounded-[10px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.05]">
              <p className="text-[14px] leading-[1.5]">
                <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">@{repostTarget.authorName}</span>
                <span className="text-black/75 dark:text-white/75">：{repostTarget.content.slice(0, 60)}</span>
              </p>
              {(repostTarget.images ?? []).length > 0 && (
                <div className="mt-2 flex gap-1.5">
                  {(repostTarget.images ?? []).slice(0, 3).map((src, i) => (
                    <img key={i} src={src} alt="原动态配图" className="h-14 w-14 rounded-[6px] object-cover" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* A1/A2「生成图片」弹层：文字图片卡片升级真图 / 升级图重新生成（同款弹层，描述预填可改） */}
      {genSheet && (
        <ZoneImageGenSheet
          title={genSheet.mode === 'upgrade' ? '生成图片' : '重新生成图片'}
          initialDesc={genSheet.desc}
          busy={genSheetBusy}
          error={genSheetError}
          onClose={() => (genSheetBusy ? undefined : setGenSheet(null))}
          onSubmit={(d) => void submitZoneGen(d)}
        />
      )}
    </div>
  );
}

// ---------------- 写说说页（空间动态「分享新鲜事」进入；对照 QQ 真机） ----------------

export function WritePostPage({
  me,
  onBack,
  onPublish,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  /** 发表：正文 + 配图 + 位置名（可选；入库/记忆/互动队列由动态引擎统一处理） */
  onPublish: (text: string, images: string[], location?: string) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [showLoc, setShowLoc] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const canPost = text.trim().length > 0 || images.length > 0;

  const pickImages = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const room = Math.max(0, 9 - images.length);
      const picked = Array.from(files).slice(0, room);
      const datas = await Promise.all(picked.map((f) => compressImageFile(f).catch(() => '')));
      setImages((prev) => [...prev, ...datas.filter(Boolean)]);
      if (files.length > room) onToast('最多选择 9 张图片');
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!canPost || busy) return;
    onPublish(text.trim(), images, location.trim() || undefined);
    onToast('已发表到空间');
    onBack();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F2F3F5] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：取消 / 写说说 / 发表 */}
      <div className="relative flex h-12 shrink-0 items-center px-4">
        <button type="button" data-testid="qq-compose-cancel" onClick={onBack} className="text-[16px] active:opacity-60">
          取消
        </button>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
          写说说
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="qq-compose-publish"
            disabled={!canPost || busy}
            onClick={publish}
            className="h-9 rounded-[10px] px-4 text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: canPost && !busy ? QQ_BLUE : '#8AD4F7' }}
          >
            发表
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 内容卡：文字 + 照片/视频 + pills */}
        <div className="rounded-[14px] bg-white px-3 pb-4 pt-4 dark:bg-[#1B1C1F]">
          <textarea
            ref={textRef}
            data-testid="qq-compose-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="分享新鲜事..."
            rows={7}
            aria-label="说说内容"
            className="w-full resize-none bg-transparent text-[17px] leading-[1.6] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={`${i}-${src.slice(-12)}`} className="relative h-[86px] w-[86px] overflow-hidden rounded-[8px]">
                <img src={src} alt={`配图${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`移除配图${i + 1}`}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            ))}
            {images.length < 9 && (
              <button
                type="button"
                data-testid="qq-compose-addimg"
                onClick={() => fileRef.current?.click()}
                className="grid h-[86px] w-[86px] place-items-center rounded-[8px] bg-black/[0.04] text-black/35 active:bg-black/[0.08] dark:bg-white/[0.06] dark:text-white/35"
              >
                <span className="flex flex-col items-center gap-1">
                  <ImageIcon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
                  <span className="text-[12px]">照片/视频</span>
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              void pickImages(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          {/* 已选位置 chip（可移除） */}
          {location && (
            <div className="mt-3 flex w-fit items-center gap-1 rounded-full bg-[#1B9FF0]/10 px-2.5 py-1 text-[12.5px] text-[#1B9FF0]" data-testid="qq-compose-location-value">
              <MapPin className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
              <span className="max-w-[180px] truncate">{location}</span>
              <button
                type="button"
                aria-label="清除位置"
                data-testid="qq-compose-location-clear"
                onClick={() => setLocation('')}
                className="ml-0.5 rounded-full p-0.5 active:bg-black/10"
              >
                <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="mt-3 flex items-center gap-1">
            {[
              { label: '@好友', icon: null, toast: '@好友暂未开放' },
              { label: '添加标签', icon: <Tag className="h-3 w-3" strokeWidth={2} aria-hidden="true" />, toast: '添加标签暂未开放' },
            ].map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => onToast(x.toast)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
              >
                {x.icon}
                {x.label}
              </button>
            ))}
            {/* 所在位置（可选内置地点/自定义位置） */}
            <button
              type="button"
              data-testid="qq-compose-location"
              onClick={() => setShowLoc(true)}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
            >
              <MapPin className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              所在位置
            </button>
            {/* 表情（unicode 表情面板，插入光标处） */}
            <button
              type="button"
              data-testid="qq-compose-emoji"
              onClick={() => setShowEmoji((v) => !v)}
              className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] whitespace-nowrap active:opacity-60 ${showEmoji ? 'bg-[#1B9FF0]/15 text-[#1B9FF0]' : 'bg-black/[0.045] text-black/55 dark:bg-white/[0.08] dark:text-white/55'}`}
            >
              <Smile className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              表情
            </button>
            <button
              type="button"
              onClick={() => onToast('AI配文暂未开放')}
              className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              AI配文
            </button>
          </div>
          {showEmoji && (
            <div className="mt-3">
              <MomentsEmojiPanel
                onPick={(e) => insertEmojiAtCursor(textRef, text, e, setText)}
                onClose={() => setShowEmoji(false)}
              />
            </div>
          )}
        </div>

        {/* 权限/发表设置卡 */}
        <div className="mt-3 rounded-[14px] bg-white px-4 dark:bg-[#1B1C1F]">
          <button
            type="button"
            onClick={() => onToast('权限设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Eye className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">权限设置</span>
            <span className="text-[14px] text-black/35 dark:text-white/35">所有人可见</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('发表设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Settings className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">发表设置</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 位置选择（复用聊天发送位置的内置地点/自定义位置页；选中即回填位置名） */}
      {showLoc && (
        <div className="absolute inset-0 z-40">
          <LocationPickerPage
            onClose={() => setShowLoc(false)}
            onSend={(loc) => {
              setLocation(loc.name);
              setShowLoc(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
