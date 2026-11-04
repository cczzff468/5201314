'use client';

/**
 * 朋友圈 / QQ动态 统一引擎（AI 发动态 × 动态互动 × 动态与记忆双向打通）。
 *
 * 设计要点：
 * - 数据继续存在各自 App 的既有键里（wx-moments / qq-zone-posts + qq-zone-comments，IndexedDB kv），
 *   本模块把它们归一化为统一的 MomentPostView（平台无关），UI 与 AI 流程只面向统一视图；
 *   旧数据原位兼容读取：author 用显式字段，缺省按「authorName 是否等于机主名」推断；
 *   新写入一律带显式 author/peerId/parentId/createdAt 字段（无损往返）。
 * - 每条动态/评论带 peerId（AI 角色联系人 id）：不同角色的动态与记忆按联系人 ID 隔离（六.2）；
 *   用户广播动态 peerId=null（朋友圈语义：所有好友可见）。
 * - 动态 → 记忆（三）：角色发动态/点赞/评论/回复时，立即给「该角色」写一条 source='moments'
 *   的记忆碎片（带 sourcePostId 追溯，走 appendFragments 同款去重合并管线）；
 *   用户广播动态由「看到它的角色」入记忆：互动发生时写入 + 聊天注入块懒写入（见 buildMomentsChatBlock），
 *   避免把每条动态复制进所有角色的记忆库（记忆去重/权重不受污染）。
 * - 视角统一：记忆碎片一律用「机主真实名字 + 角色真实名字」指代（动态展示名可以用昵称，
 *   写记忆前异步换回真实名字，与聊天记忆同规则）。
 * - 记忆 → 动态（一.4）：AI 发动态/评论的内容基于 persona + 最近聊天（memRecentConvo）+ 记忆库
 *   （listFragments）生成，不同角色人设不同 → 风格天然不同（一.5）。
 * - 聊天 → 动态感知（四）：buildMomentsChatBlock 组装「最近发过的动态 + 相关互动」注入私聊 system，
 *   标注「这是动态内容不是私聊」；互通开关关闭时只注入当前 App 对应平台的动态（六.3）。
 * - AI 自动发布三种触发（一.6）：定时（每天 HH:mm）/ 频率（每隔 N 小时）/ 聊天灵感（累计聊天轮次
 *   达阈值且冷却期已过），由全局调度（MomentsScheduler 每 5s tick）驱动，漏检自动补发；
 *   失败按 10 分钟退避重试，绝不阻塞 UI。
 * - AI 互动（二）：用户发动态后进延迟队列（8~18s 后由调度结算：1-2 位平台好友点赞+评论）；
 *   用户回复 AI 评论 → 延迟 3~8s 生成 AI 的再回复（多轮，parentId 串链）；
 *   队列持久化在 kv，重启后仍会结算（二.5 持久化）。
 */

import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { branchRootIdOf, getBranchMeta, isBranchBirthSilent } from '@/lib/ios/branch-meta';
import { contactByRef, displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { useSettings, type ApiConfig } from '@/lib/ios/store';
import { contactRealName, listContacts, ownerRealName, ownerRealNameFor } from '@/lib/ios/contacts-store';
import { extractPhotoTags, generateCharacterPhoto, imgGenConfigReady } from '@/lib/imggen';
import {
  getMemSettings,
  listFragments,
  memAddMomentFragment,
  memDeleteFragmentByIds,
  memHasMomentFragment,
  memPurgeMomentSources,
  memRecentConvo,
  memRewriteMomentFragmentTexts,
  setMemScopeForApp,
  type MemApp,
} from '@/lib/memory';
import { DEFAULT_BILINGUAL_PROMPT, getMomentsSettings } from '@/lib/ios/moments-settings';
import { loadBlock } from '@/lib/ios/block-state';
// 相册挂点：动态配图生成成功后同步写入该角色的 AI 相册（与聊天端 flushPhotoJobs 同口径）
import { addAlbum } from '@/lib/ios/album-store';

// ---------------- 统一数据模型（视图层） ----------------

export type MomentPlatform = 'wx' | 'qq';
export type MomentAuthor = 'user' | 'char';

export interface MomentLikeView {
  name: string;
  author: MomentAuthor;
  /** char 点赞时 = 该角色联系人 id（legacy 数据可能为 null） */
  peerId: string | null;
  time: number;
}

export interface MomentCommentView {
  id: string;
  author: MomentAuthor;
  authorName: string;
  /** char 评论时 = 该角色联系人 id（legacy 数据可能为 null） */
  peerId: string | null;
  content: string;
  /** 双语翻译（简体中文译文；空串/缺失表示无译文，旧数据兼容） */
  contentZh?: string;
  createdAt: number;
  /** 多轮回复：父评论 id（根评论为 null） */
  parentId: string | null;
  /** 展示用「回复@某人」的名字 */
  replyToName: string | null;
}

export interface MomentPostView {
  id: string;
  platform: MomentPlatform;
  author: MomentAuthor;
  authorName: string;
  avatar: string | null;
  /** char 发的动态 = 该角色联系人 id；用户广播动态 = null */
  peerId: string | null;
  content: string;
  /** 双语翻译（简体中文译文；空串/缺失表示无译文，旧数据兼容） */
  contentZh?: string;
  images: string[];
  /** 「文字图片」卡片文字（AI 动态配图降级：未配置生图/生成失败时，画面描述印在卡片上充当配图；
   *  点击卡片可在配置了生图后升级为真实照片，见 upgradeMomentTextCard） */
  textCard?: string;
  /** 该卡片是否已升级为真实照片（textCard 已清空、images 非空；用于「重新生成」入口的资格判定） */
  textCardUpgraded?: boolean;
  /** 最近一次生成/升级这张照片实际使用的画面描述（供重新生成时预填与兜底；legacy 帖子可能没有） */
  textCardDesc?: string;
  /** 发动态时附的位置名（如「广州塔」；可选） */
  location?: string;
  /** 转发引用（QQ 空间转发：本条是转发理由，原动态摘要嵌在里面；可选） */
  repostOf?: MomentRepostRef;
  createdAt: number;
  likes: MomentLikeView[];
  comments: MomentCommentView[];
}

/** 转发引用：指向被转发的原动态（摘要快照，原动态删除后仍可展示） */
export interface MomentRepostRef {
  postId: string;
  author: MomentAuthor;
  authorName: string;
  /** 原动态内容摘要（截短） */
  content: string;
  /** 原动态配图快照（最多 3 张） */
  images: string[];
}

/**
 * 互动消息（与我的互动收件箱一条记录）：
 * - like：有人赞了「我发的」动态；
 * - comment：有人评论了「我发的」动态；
 * - reply：有人回复了「我的评论」（不论原动态是谁发的）；
 * - repost：有人转发了「我发的」动态（QQ 空间）；
 * - official：平台官方消息（QQ 空间官方等）；system：保留分类。
 * 每条带原动态摘要快照（postSummary/postImage），原动态删除后消息仍可读；
 * 回复入口仅对 comment/reply 有效（postId 还在时）。
 */
export interface MomentNotice {
  id: string;
  platform: MomentPlatform;
  kind: 'like' | 'comment' | 'reply' | 'repost' | 'official' | 'system';
  actorName: string;
  actorKind: MomentAuthor;
  /** char 互动时 = 联系人 id；official/system = null */
  actorPeerId: string | null;
  actorAvatar: string | null;
  /** 相关动态 id（official/system 为空串） */
  postId: string;
  /** 原动态作者名（谁发的被互动的动态） */
  postAuthorName: string;
  /** 原动态内容摘要快照 */
  postSummary: string;
  /** 原动态首图快照（微信互动页右侧缩略图用） */
  postImage: string | null;
  /** comment/reply：互动的那条评论 id（回复入口定位） */
  commentId?: string;
  /** reply：被回复的那条评论是谁发的 */
  replyToName?: string | null;
  /** 消息正文：评论/回复/转发理由/官方文案（like 为空串） */
  content: string;
  createdAt: number;
  read?: boolean;
}

/** 平台中文标签（prompt/记忆标注用） */
export const MOMENT_PLATFORM_LABEL: Record<MomentPlatform, string> = { wx: '朋友圈', qq: 'QQ动态' };

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function isMomentPlatform(v: unknown): v is MomentPlatform {
  return v === 'wx' || v === 'qq';
}

// ---------------- 底层存储适配（保持旧键旧形状，原位兼容） ----------------

const WX_MOMENTS_KEY = 'wx-moments';
const QQ_POSTS_KEY = 'qq-zone-posts';
const QQ_COMMENTS_KEY = 'qq-zone-comments';
/** 互动消息收件箱（与我的互动 / 空间消息），按平台分库；
 *  多账号（Task 42）：键改 `wx-`/`qq-` 前缀命中账号作用域映射——收件箱随账号隔离，
 *  切换账号只看到当前账号朋友圈的互动（旧裸键 moments-inbox:* 不再读写，残留自然失效） */
const noticesKey = (platform: MomentPlatform) => `${platform}-moments-inbox`;
/** 收件箱容量上限（新消息在前） */
const NOTICE_CAP = 120;
/** 各平台机主展示名（写入时记住，legacy 数据作者推断用） */
const USER_NAMES_KEY = 'moments-user-names';
/** 互动/回复延迟队列 */
const QUEUE_KEY = 'moments-queue';
/** 每角色×平台自动发布设置 */
const AUTO_CFG_KEY = 'moments-auto-cfg';
/** 自动发布失败退避 */
const attemptKey = (contactId: string, platform: MomentPlatform) => `moments-auto-attempt:${contactId}:${platform}`;
/** SDK/上游账号级 429 限流的全局冷却标记：自动发帖全部暂停 5 分钟，
 *  别让几十个角色排队撞墙耗光配额——论坛翻译/生成等前台功能更需要这点份额 */
const GLOBAL_429_UNTIL_KEY = 'moments-auto-429-until';
const GLOBAL_429_COOLDOWN_MS = 5 * 60_000;

/** C4：聊天路径 [发朋友圈] 落库后登记尝试标记——调度器 10 分钟内不再为该角色自动发帖
 *  （聊天路径此前不写标记，调度器可能在几秒后同刻再自动发一条，同屏双帖穿帮） */
export function markMomentAutoAttempt(platform: MomentPlatform, contactId: string): void {
  try {
    kvSet(attemptKey(contactId, platform), Date.now());
  } catch {
    /* 静默 */
  }
}

/** 动态变更事件：引擎每次落盘后广播，动态页监听刷新（调度器在页面外写数据也能实时同步 UI） */
export function emitMomentsChanged(platform?: MomentPlatform): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('moments-changed', { detail: { platform: platform ?? null } }));
    }
  } catch {
    // 忽略
  }
}

/** 订阅动态变更（返回退订函数） */
export function subscribeMomentsChanged(fn: (platform: MomentPlatform | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { platform?: MomentPlatform | null } | null;
    fn(d && isMomentPlatform(d.platform) ? d.platform : null);
  };
  window.addEventListener('moments-changed', handler);
  return () => window.removeEventListener('moments-changed', handler);
}

// 旧形状（微信 WxMoment / QQ ZonePost+ZoneComment 的最小读取形状，全部宽容可选）

interface WxRawComment {
  id?: unknown;
  author?: unknown;
  text?: unknown;
  contentZh?: unknown;
  time?: unknown;
  replyTo?: unknown;
  authorKind?: unknown;
  peerId?: unknown;
  parentId?: unknown;
  createdAt?: unknown;
}
interface WxRawPost {
  id?: unknown;
  authorName?: unknown;
  avatar?: unknown;
  text?: unknown;
  contentZh?: unknown;
  images?: unknown;
  textCard?: unknown;
  textCardUpgraded?: unknown;
  textCardDesc?: unknown;
  time?: unknown;
  likes?: unknown;
  comments?: unknown;
  author?: unknown;
  peerId?: unknown;
  location?: unknown;
  repostOf?: unknown;
}
interface QqRawComment {
  id?: unknown;
  author?: unknown;
  content?: unknown;
  contentZh?: unknown;
  time?: unknown;
  replyTo?: unknown;
  authorKind?: unknown;
  peerId?: unknown;
  parentId?: unknown;
  createdAt?: unknown;
}
interface QqRawPost {
  id?: unknown;
  authorName?: unknown;
  avatar?: unknown;
  content?: unknown;
  contentZh?: unknown;
  time?: unknown;
  likedBy?: unknown;
  images?: unknown;
  textCard?: unknown;
  textCardUpgraded?: unknown;
  textCardDesc?: unknown;
  author?: unknown;
  peerId?: unknown;
  createdAt?: unknown;
  location?: unknown;
  repostOf?: unknown;
}

const PLATFORM_USER_NAMES: Record<MomentPlatform, string> = { wx: '', qq: '' };

let userNamesLoaded = false;

function loadUserNames(): void {
  if (userNamesLoaded) return;
  userNamesLoaded = true;
  try {
    const raw = kvGet<Partial<Record<MomentPlatform, string>>>(USER_NAMES_KEY);
    if (raw && typeof raw === 'object') {
      if (typeof raw.wx === 'string') PLATFORM_USER_NAMES.wx = raw.wx;
      if (typeof raw.qq === 'string') PLATFORM_USER_NAMES.qq = raw.qq;
    }
  } catch {
    // 忽略
  }
}

/** 记住机主在某平台的展示名（写操作时调用；legacy 数据作者推断用，读操作不回写） */
export function rememberMomentUserName(platform: MomentPlatform, name: string): void {
  if (!name || PLATFORM_USER_NAMES[platform] === name) return;
  loadUserNames();
  PLATFORM_USER_NAMES[platform] = name;
  try {
    kvSet(USER_NAMES_KEY, { wx: PLATFORM_USER_NAMES.wx, qq: PLATFORM_USER_NAMES.qq });
  } catch {
    // 忽略
  }
}

/** 作者类型：显式字段优先；缺省按名字推断（机主名命中 = user，否则 char） */
function authorOf(name: string, explicit: unknown, userNames: string[]): MomentAuthor {
  if (explicit === 'user' || explicit === 'char') return explicit;
  return userNames.includes(name) ? 'user' : 'char';
}

/** QQ 空间旧数据的 "MM-DD HH:mm" 展示串 → 时间戳（本年；解析失败 null） */
function qqTimeToTs(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = new Date().getFullYear();
  return new Date(y, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])).getTime();
}

/** 时间戳 → QQ 空间展示串 */
function qqTsToTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 宽容解析转发引用快照（旧数据/损坏数据安全回退 undefined） */
function parseRepostRef(v: unknown): MomentRepostRef | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.postId !== 'string' || !r.postId) return undefined;
  const author = r.author === 'user' || r.author === 'char' ? r.author : 'char';
  return {
    postId: r.postId,
    author,
    authorName: str(r.authorName, '好友'),
    content: str(r.content),
    images: strArr(r.images).slice(0, 3),
  };
}

/**
 * 读某平台全部动态（统一视图）。
 * userName = 机主展示名（作者推断候选之一；与记住的各平台机主名一起参与 legacy 推断）。
 * contacts 用于把 legacy 数据的 char 名字解析成 peerId（可省，省时 peerId 可能 null）。
 */
export function listMomentPosts(
  platform: MomentPlatform,
  userName?: string,
  contacts?: Pick<ContactRecord, 'id' | 'name' | 'nickname'>[]
): MomentPostView[] {
  loadUserNames();
  const userNames = Array.from(new Set([userName ?? '', PLATFORM_USER_NAMES[platform]].filter(Boolean)));
  /** legacy char 名字 → 联系人 id（展示名/真名都认） */
  const peerIdByName = (name: string): string | null => {
    if (!contacts) return null;
    const hit = contacts.find((c) => displayNameOf(c) === name || c.name === name);
    return hit?.id ?? null;
  };
  try {
    if (platform === 'wx') {
      const raw = kvGet<WxRawPost[]>(WX_MOMENTS_KEY);
      if (!Array.isArray(raw)) return [];
      const out: MomentPostView[] = [];
      for (const p of raw) {
        if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.time !== 'number') continue;
        const createdAt: number = p.time;
        const authorName = str(p.authorName, '微信用户');
        const author = authorOf(authorName, p.author, userNames);
        const commentsRaw = Array.isArray(p.comments) ? p.comments : [];
        out.push({
          id: p.id,
          platform,
          author,
          authorName,
          avatar: typeof p.avatar === 'string' ? p.avatar : null,
          peerId: typeof p.peerId === 'string' ? p.peerId : author === 'char' ? peerIdByName(authorName) : null,
          content: str(p.text),
          contentZh: str(p.contentZh) || undefined,
          images: strArr(p.images),
          textCard: str(p.textCard) || undefined,
          textCardUpgraded: p.textCardUpgraded === true || undefined,
          textCardDesc: str(p.textCardDesc) || undefined,
          location: str(p.location) || undefined,
          repostOf: parseRepostRef(p.repostOf),
          createdAt,
          likes: strArr(p.likes).map((name) => ({
            name,
            author: authorOf(name, undefined, userNames),
            peerId: peerIdByName(name),
            time: createdAt,
          })),
          comments: commentsRaw
            .filter((c): c is WxRawComment => Boolean(c) && typeof c === 'object')
            .map((c) => {
              const nm = str(c.author);
              const kind = authorOf(nm, c.authorKind, userNames);
              const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
              // 旧版遗留修复（一.1）：AI「回复自己」（replyTo 是自己的名字）是历史 bug 数据，读出来时摘掉错误指向，降为独立评论
              const selfReply = kind === 'char' && rawReplyTo !== null && rawReplyTo === nm;
              return {
                id: str(c.id) || uid(),
                author: kind,
                authorName: nm,
                peerId: typeof c.peerId === 'string' ? c.peerId : kind === 'char' ? peerIdByName(nm) : null,
                content: str(c.text),
                contentZh: str(c.contentZh) || undefined,
                createdAt:
                  typeof c.createdAt === 'number' ? c.createdAt : typeof c.time === 'number' ? c.time : createdAt,
                parentId: selfReply ? null : typeof c.parentId === 'string' ? c.parentId : null,
                replyToName: selfReply ? null : rawReplyTo,
              };
            }),
        });
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    }
    const raw = kvGet<QqRawPost[]>(QQ_POSTS_KEY);
    if (!Array.isArray(raw)) return [];
    const rawComments = kvGet<Record<string, QqRawComment[]>>(QQ_COMMENTS_KEY);
    const cmap: Record<string, QqRawComment[]> =
      rawComments && typeof rawComments === 'object' && !Array.isArray(rawComments) ? rawComments : {};
    const out: MomentPostView[] = [];
    for (const p of raw) {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.content !== 'string') continue;
      const authorName = str(p.authorName, 'QQ用户');
      const author = authorOf(authorName, p.author, userNames);
      const createdAt = typeof p.createdAt === 'number' ? p.createdAt : (qqTimeToTs(p.time) ?? Date.now());
      const comments = (Array.isArray(cmap[p.id]) ? cmap[p.id] : [])
        .filter((c): c is QqRawComment => Boolean(c) && typeof c === 'object')
        .map((c) => {
          const nm = str(c.author);
          const kind = authorOf(nm, c.authorKind, userNames);
          const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
          // 同微信分支：AI「回复自己」的历史 bug 数据读时修复
          const selfReply = kind === 'char' && rawReplyTo !== null && rawReplyTo === nm;
          return {
            id: str(c.id) || uid(),
            author: kind,
            authorName: nm,
            peerId: typeof c.peerId === 'string' ? c.peerId : kind === 'char' ? peerIdByName(nm) : null,
            content: str(c.content),
            contentZh: str(c.contentZh) || undefined,
            createdAt: typeof c.createdAt === 'number' ? c.createdAt : (qqTimeToTs(c.time) ?? createdAt),
            parentId: selfReply ? null : typeof c.parentId === 'string' ? c.parentId : null,
            replyToName: selfReply ? null : rawReplyTo,
          };
        });
      out.push({
        id: p.id,
        platform,
        author,
        authorName,
        avatar: typeof p.avatar === 'string' ? p.avatar : null,
        peerId: typeof p.peerId === 'string' ? p.peerId : author === 'char' ? peerIdByName(authorName) : null,
        content: p.content,
        contentZh: str(p.contentZh) || undefined,
        images: strArr(p.images),
        textCard: str(p.textCard) || undefined,
        textCardUpgraded: p.textCardUpgraded === true || undefined,
        textCardDesc: str(p.textCardDesc) || undefined,
        location: str(p.location) || undefined,
        repostOf: parseRepostRef(p.repostOf),
        createdAt,
        likes: strArr(p.likedBy).map((name) => ({
          name,
          author: authorOf(name, undefined, userNames),
          peerId: peerIdByName(name),
          time: createdAt,
        })),
        comments,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** 视图 → 微信原始形状映射（persistMomentPosts / appendCopiedWxMomentPosts 共用，无损往返） */
function wxViewToRawPost(p: MomentPostView) {
  return {
    id: p.id,
    authorName: p.authorName,
    avatar: p.avatar,
    text: p.content,
    contentZh: p.contentZh || undefined,
    images: p.images,
    textCard: p.textCard || undefined,
    textCardUpgraded: p.textCardUpgraded || undefined,
    textCardDesc: p.textCardDesc || undefined,
    time: p.createdAt,
    author: p.author,
    peerId: p.peerId ?? undefined,
    location: p.location || undefined,
    repostOf: p.repostOf ?? undefined,
    likes: p.likes.map((l) => l.name),
    comments: p.comments.map((c) => ({
      id: c.id,
      author: c.authorName,
      text: c.content,
      contentZh: c.contentZh || undefined,
      time: c.createdAt,
      replyTo: c.replyToName,
      authorKind: c.author,
      peerId: c.peerId ?? undefined,
      parentId: c.parentId ?? undefined,
      createdAt: c.createdAt,
    })),
  };
}

/** 写回某平台全部动态（旧形状 + 引擎扩展字段，无损往返） */
function persistMomentPosts(platform: MomentPlatform, posts: MomentPostView[]): void {
  try {
    if (platform === 'wx') {
      const raw = posts.slice(0, 200).map(wxViewToRawPost);
      kvSet(WX_MOMENTS_KEY, raw);
    } else {
      const cmap: Record<string, unknown[]> = {};
      const raw = posts.slice(0, 200).map((p) => {
        cmap[p.id] = p.comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          content: c.content,
          contentZh: c.contentZh || undefined,
          time: qqTsToTime(c.createdAt),
          replyTo: c.replyToName ?? undefined,
          authorKind: c.author,
          peerId: c.peerId ?? undefined,
          parentId: c.parentId ?? undefined,
          createdAt: c.createdAt,
        }));
        return {
          id: p.id,
          authorName: p.authorName,
          avatar: p.avatar,
          content: p.content,
          contentZh: p.contentZh || undefined,
          time: qqTsToTime(p.createdAt),
          likedBy: p.likes.map((l) => l.name),
          images: p.images,
          textCard: p.textCard || undefined,
          textCardUpgraded: p.textCardUpgraded || undefined,
          textCardDesc: p.textCardDesc || undefined,
          author: p.author,
          peerId: p.peerId ?? undefined,
          createdAt: p.createdAt,
          location: p.location || undefined,
          repostOf: p.repostOf ?? undefined,
        };
      });
      kvSet(QQ_POSTS_KEY, raw);
      kvSet(QQ_COMMENTS_KEY, cmap);
    }
    emitMomentsChanged(platform);
  } catch {
    // 存储失败静默（动态是增强能力）
  }
}

/**
 * 角色分支（branch.ts）专用：把分支点之前该角色的动态副本追加进微信朋友圈数组。
 * 只在原始数组尾部追加、原帖字节不动（不做全量往返）——其余动态/评论 id 保持稳定，
 * 其它角色的记忆 sourcePostId/sourceCommentId 引用不被扰动；超 200 条滚动窗口与既有口径一致。
 */
export function appendCopiedWxMomentPosts(posts: MomentPostView[]): void {
  if (!Array.isArray(posts) || posts.length === 0) return;
  try {
    const raw = kvGet<WxRawPost[]>(WX_MOMENTS_KEY);
    const list = Array.isArray(raw) ? raw : [];
    kvSet(WX_MOMENTS_KEY, [...list, ...posts.map(wxViewToRawPost)].slice(-200));
    emitMomentsChanged('wx');
  } catch {
    // 静默
  }
}

// ---------------- 互动消息收件箱（与我的互动 / 空间消息；谁赞了我/评论了我/回复了我/转发了我） ----------------

function loadNoticesSafe(platform: MomentPlatform): MomentNotice[] | null {
  try {
    const raw = kvGet<MomentNotice[]>(noticesKey(platform));
    if (raw === undefined || raw === null) return null; // 从未建立过收件箱（kvGet 缺键返回 null）
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (n): n is MomentNotice =>
          Boolean(n) &&
          typeof n === 'object' &&
          typeof n.id === 'string' &&
          typeof n.actorName === 'string' &&
          typeof n.createdAt === 'number' &&
          typeof n.content === 'string' &&
          (n.kind === 'like' || n.kind === 'comment' || n.kind === 'reply' || n.kind === 'repost' || n.kind === 'official' || n.kind === 'system')
      )
      .slice(0, NOTICE_CAP);
  } catch {
    return [];
  }
}

/** QQ 空间首次打开收件箱时种一条官方欢迎消息（「官方」分类内容；微信无官方分类不种） */
function seedOfficialNotice(platform: MomentPlatform, now: number): MomentNotice[] {
  if (platform !== 'qq') return [];
  return [
    {
      id: uid(),
      platform,
      kind: 'official',
      actorName: 'QQ空间官方',
      actorKind: 'char',
      actorPeerId: null,
      actorAvatar: null,
      postId: '',
      postAuthorName: '',
      postSummary: '',
      postImage: null,
      content: '欢迎来到QQ空间！好友的新动态会实时更新在这里，去逛逛吧。',
      createdAt: now - 60_000,
      read: false,
    },
  ];
}

/** 读收件箱（新消息在前；QQ 首次读取自动种一条官方欢迎消息） */
export function listMomentNotices(platform: MomentPlatform): MomentNotice[] {
  const existing = loadNoticesSafe(platform);
  if (existing !== null) return existing;
  const seeded = seedOfficialNotice(platform, Date.now());
  if (seeded.length > 0) {
    try {
      kvSet(noticesKey(platform), seeded);
    } catch {
      // 忽略
    }
  }
  return seeded;
}

function saveNotices(platform: MomentPlatform, list: MomentNotice[]): void {
  try {
    kvSet(noticesKey(platform), list.slice(0, NOTICE_CAP));
    emitMomentsChanged(platform);
  } catch {
    // 忽略
  }
}

/** 追加一条互动消息（引擎在角色点赞/评论/回复/转发用户相关内容时调用；未读，置顶） */
function pushMomentNotice(platform: MomentPlatform, n: Omit<MomentNotice, 'id' | 'platform' | 'createdAt' | 'read'>): void {
  // 互动提示音（设置 › 通知可配）：朋友圈(wx)→moments，QQ空间(qq)→qzone；
  // 静音/免打扰由 playNotifySound 内部闸门判定，收件箱记录照常落
  playNotifySound(platform === 'wx' ? 'moments' : 'qzone');
  const list = loadNoticesSafe(platform);
  const next: MomentNotice = { ...n, id: uid(), platform, createdAt: Date.now(), read: false };
  saveNotices(platform, [next, ...(list ?? [])]);
}

/** 未读互动消息条数（「1条新消息」气泡） */
export function unreadMomentNoticeCount(platform: MomentPlatform): number {
  return (loadNoticesSafe(platform) ?? []).filter((n) => !n.read).length;
}

/** 全部标记已读（打开互动消息页时调用；气泡随之消失） */
export function markAllMomentNoticesRead(platform: MomentPlatform): void {
  const list = loadNoticesSafe(platform);
  if (!list || !list.some((n) => !n.read)) return;
  saveNotices(
    platform,
    list.map((n) => (n.read ? n : { ...n, read: true }))
  );
}

// ---------------- 角色匹配小工具 ----------------

/** 该动态是否由这个联系人发布（peerId 优先，legacy 数据按展示名/真名兜底） */
export function isPostByPeer(
  post: Pick<MomentPostView, 'author' | 'peerId' | 'authorName'>,
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>
): boolean {
  if (post.author !== 'char') return false;
  if (post.peerId && post.peerId === peer.id) return true;
  // Task 38（2A）：分支角色只认 peerId 精确归属——legacy 名字兜底会让分支与本体双认领同一条
  // 旧动态（分支后来改名贴近原名时尤甚），两边同时把同一条动态当成自己发的
  if (getBranchMeta(peer.id)) return false;
  return post.authorName === displayNameOf(peer) || post.authorName === peer.name;
}

/** 该互动（点赞/评论）是否由这个联系人发出 */
function isInteractionByPeer(
  x: { author: MomentAuthor; peerId: string | null; authorName?: string; name?: string },
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>
): boolean {
  if (x.author !== 'char') return false;
  if (x.peerId && x.peerId === peer.id) return true;
  // Task 38（2A）：分支角色同款只认 peerId（防与本体双认领同一条 legacy 点赞/评论）
  if (getBranchMeta(peer.id)) return false;
  const nm = x.authorName ?? x.name ?? '';
  return nm === displayNameOf(peer) || nm === peer.name;
}

/** 平台 → 记忆 App 标记（动态来源记忆的 app 字段：互通关闭时按平台过滤召回） */
function platformApp(platform: MomentPlatform): MemApp {
  return platform === 'wx' ? 'wx' : 'qq';
}

/** 平台 → 完整 App 名（记忆/注入块标注「在哪个 App 发的」：朋友圈=微信、QQ动态=QQ空间，杜绝只写「朋友圈」时归属含糊） */
const MOMENT_APP_FULL_LABEL: Record<MomentPlatform, string> = { wx: '微信朋友圈', qq: 'QQ空间' };

/**
 * 动态记忆里的绝对时间标注（「什么时间发的」）：M月D日 HH:mm；跨年补年份。
 * 用本机时区格式化（与动态列表展示时间同口径）；ts 缺失返回空串（调用方省略时间段）。
 */
function momentMemoryTimeLabel(ts: number | undefined | null): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 该角色是否处于拉黑状态（双向）：byUser = 用户拉黑了角色；byChar = 角色拉黑了用户。
 * 真实语义都是双向不可见——拉黑期间动态引擎停止该角色的一切主动互动
 * （给用户动态点赞/评论/回复、转发、自动发帖、回复用户评论）。
 * 状态每次现场读取（loadBlock），拉黑可解除，解除后互动自然恢复（不写死任何状态）。
 */
function isPeerBlocked(platform: MomentPlatform, peerId: string): boolean {
  if (!peerId) return false;
  try {
    const b = loadBlock(platform, peerId);
    return b.byUser === true || b.byChar === true;
  } catch {
    return false;
  }
}

// ---------------- 动态 → 记忆（异步解析真实名字后入库，fire-and-forget） ----------------

/**
 * 记忆事实（展示名传入，真实名字在入库前解析替换——与聊天记忆的视角统一规则一致）。
 * shape 决定记忆句式。归属标注铁律（谁发的绝不能含糊）：每条记忆都写明
 * 「谁（角色标注）+ 在哪个 App（微信朋友圈/QQ空间）+ 什么时间」——
 * 「（AI角色本人）」= 记忆库主人自己，「（用户本人）」= 机主用户；AI 私聊读记忆时据此
 * 区分「是我自己发的动态」还是「用户发的动态」，绝不把自己的动态当成用户的行为：
 * - char-post：{peer}（AI角色本人）于{time}在微信朋友圈发了一条动态：「detail」
 * - user-post：{user}（用户本人）于{time}在微信朋友圈发了一条动态：「detail」{extra（该角色的互动摘要）}
 * - like：{peer}（AI角色本人）于{time}给{归属人（标注）}的微信朋友圈动态点了赞（动态：「postDetail」）——归属人默认机主，角色动态用 postAuthorPeerId 解析
 * - char-comment：{peer}（AI角色本人）于{time}评论了{归属人（标注）}的微信朋友圈动态：「detail」（动态：「postDetail」）——归属人同上
 * - char-reply：{peer}（AI角色本人）于{time}回复了{被回复人（标注）}的评论：「detail」（动态：「postDetail」）——被回复人默认机主，回复角色评论用 replyTargetPeerId 解析
 * - user-comment：{user}（用户本人）于{time}评论了{peer}（AI角色本人）的微信朋友圈动态：「detail」
 * - user-reply：{user}（用户本人）于{time}回复了{peer}（AI角色本人）的评论：「detail」（动态：「postDetail」）
 * - user-like：{user}（用户本人）于{time}给你的微信朋友圈动态点了赞（动态：「postDetail」）——机主赞了该角色（记忆主人）发的动态
 */
interface MomentMemoryFact {
  peerId: string;
  platform: MomentPlatform;
  postId: string;
  commentId?: string;
  sourceTime?: number;
  shape:
    | 'char-post'
    | 'user-post'
    | 'like'
    | 'user-like'
    | 'char-comment'
    | 'char-reply'
    | 'user-comment'
    | 'user-reply';
  peerDisplay: string;
  userName: string;
  detail: string;
  postDetail?: string;
  extra?: string;
  /** 动态归属人是另一角色时传（like/char-comment 句式的归属人；缺省=机主）。
   *  角色动态但归属人无法定位时（legacy 无 peerId）不得写入记忆（宁缺勿错） */
  postAuthorPeerId?: string;
  /** 动态归属人的展示名（真名解析失败的兜底；不可为空兜底到机主） */
  postAuthorDisplay?: string;
  /** 回复目标是另一角色的评论时传（char-reply 句式的被回复人；缺省=机主） */
  replyTargetPeerId?: string;
  /** 被回复人的展示名（真名解析失败的兜底） */
  replyTargetDisplay?: string;
}

function memoryContentOf(
  f: MomentMemoryFact,
  peerReal: string,
  userReal: string,
  extraReal?: { postAuthor?: string; replyTarget?: string }
): string {
  const peer = peerReal || f.peerDisplay || '对方';
  const user = userReal || f.userName || '用户';
  const app = MOMENT_APP_FULL_LABEL[f.platform];
  const t = momentMemoryTimeLabel(f.sourceTime);
  const at = t ? `于${t}` : ''; // 时间段（记忆必须标时间；无来源时间时省略）
  // 主语角色标注：「AI角色本人」= 记忆库主人（AI）自己；「用户本人」= 机主；其余 AI 角色标「AI角色」
  const peerTagged = `${peer}（AI角色本人）`;
  const userTagged = `${user}（用户本人）`;
  // 动态归属人标注（like/char-comment 的「谁的动态」）：角色动态 →（AI角色）；机主动态 →（用户本人）
  const authorTag = f.postAuthorPeerId ? '（AI角色）' : '（用户本人）';
  const replyTargetTag = f.replyTargetPeerId ? '（AI角色）' : '（用户本人）';
  switch (f.shape) {
    case 'char-post':
      return `${peerTagged}${at}在${app}发了一条动态：「${f.detail}」`;
    case 'user-post':
      return `${userTagged}${at}在${app}发了一条动态：「${f.detail}」${f.extra ?? ''}`;
    case 'like': {
      // 归属人：角色动态用真实发帖人真名（解析失败用展示名；都无法确定返回空串→不写入，宁缺勿错）
      const target = f.postAuthorPeerId ? extraReal?.postAuthor || f.postAuthorDisplay || '' : user;
      if (!target) return '';
      const targetTagged = f.postAuthorPeerId ? `${target}（AI角色）` : `${target}${authorTag}`;
      return `${peerTagged}${at}给${targetTagged}的${app}动态点了赞（动态：「${f.postDetail ?? f.detail}」）`;
    }
    case 'user-like':
      // 机主赞了该角色（记忆主人）的动态：以角色为中心的视角（「凡凡给你的朋友圈动态点了赞」）
      return `${userTagged}${at}给你的${app}动态点了赞（动态：「${f.postDetail ?? f.detail}」）`;
    case 'char-comment': {
      const target = f.postAuthorPeerId ? extraReal?.postAuthor || f.postAuthorDisplay || '' : user;
      if (!target) return '';
      const targetTagged = f.postAuthorPeerId ? `${target}（AI角色）` : `${target}${authorTag}`;
      return `${peerTagged}${at}评论了${targetTagged}的${app}动态：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
    }
    case 'char-reply': {
      const target = f.replyTargetPeerId ? extraReal?.replyTarget || f.replyTargetDisplay || '' : user;
      if (!target) return '';
      const targetTagged = f.replyTargetPeerId ? `${target}（AI角色）` : `${target}${replyTargetTag}`;
      return `${peerTagged}${at}回复了${targetTagged}的评论：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
    }
    case 'user-comment':
      return `${userTagged}${at}评论了${peerTagged}的${app}动态：「${f.detail}」`;
    case 'user-reply':
      return `${userTagged}${at}回复了${peerTagged}的评论：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
  }
}

/**
 * 记忆时刻（句式「于…」时间段与碎片时间戳共用同一口径，写入/纠错两端口径一致）：
 * 动态=发布时刻；评论=评论时刻；点赞=点赞记录时刻（user-like 优先于角色点赞，与句式分流顺序一致）。
 */
function momentFactSourceTimeOf(
  kind: 'post' | 'like' | 'comment',
  post: MomentPostView,
  comment: MomentCommentView | null | undefined,
  contact: Pick<ContactRecord, 'id' | 'name' | 'nickname'>
): number {
  if (kind === 'post') return post.createdAt;
  if (kind === 'comment' && comment) return comment.createdAt || post.createdAt;
  if (kind === 'like') {
    const userLike = post.likes.find((l) => l.author === 'user');
    if (userLike && isPostByPeer(post, contact)) return userLike.time || post.createdAt;
    return post.likes.find((l) => isInteractionByPeer(l, contact))?.time || post.createdAt;
  }
  return post.createdAt;
}

/**
 * 【单一事实源】动态记忆「应写句式」生成器：给定动态/评论的数据真实形态 + 记忆主人（contact），
 * 按写入口径算出这条记忆应该长什么样（memoryContentOf 八句式之一，含
 * 「谁（AI角色本人/用户本人）+于时间+在微信朋友圈/QQ空间」标注）。
 * 写入侧（writeMomentMemory）与纠错侧（repairMomentIdentityData）都调它，杜绝两端口径漂移。
 *
 * 合法主人矩阵（谁的记忆库里该有这条碎片，按数据真实形态分流）：
 * - post + 用户广播动态：任意 char（看到它的角色）都合法——懒写入/读取侧口径，extra 带本人互动从句；
 * - post + 角色动态：主人=发帖人本人（isPostByPeer 校验）；
 * - like + 机主赞了角色动态（user-like）：主人=动态作者；like + 角色点赞（like）：主人=点赞人本人；
 * - comment + 角色评论/回复：主人=评论人本人（isInteractionByPeer 校验）；
 * - comment + 用户回复角色评论（user-reply）：主人=被回复的角色；
 * - comment + 用户顶层评论（user-comment）：主人=动态作者；
 * - comment + 用户回复用户评论 / 悬空回复：写入侧本就不产生记忆 → null。
 * 返回 null = 按数据真实形态无法为本主人生成正确句式（校验失败/关系建立不了）——
 * 写入侧不写入（宁缺勿错）；repair 侧保留不删（宁留勿删）。
 */
function expectedMomentMemoryOf(
  kind: 'post' | 'like' | 'comment',
  post: MomentPostView,
  comment: MomentCommentView | null | undefined,
  contact: Pick<ContactRecord, 'id' | 'name' | 'nickname'>,
  ownerReal: string,
  realNameOf: (id: string) => string
): string | null {
  const peerDisplay = displayNameOf(contact);
  const contactReal = realNameOf(contact.id) || peerDisplay;
  const sourceTime = momentFactSourceTimeOf(kind, post, comment, contact);
  if (kind === 'post') {
    if (post.author === 'user') {
      // 用户广播动态：主人=看到它的角色本人；extra=本人与这条动态的互动从句（带「AI角色本人」标注）
      const peerComments = post.comments.filter((c) => isInteractionByPeer(c, contact));
      const extra =
        peerComments.length > 0
          ? `，你（AI角色本人）评论过：「${peerComments[peerComments.length - 1].content.slice(0, 30)}」`
          : post.likes.some((l) => isInteractionByPeer(l, contact))
            ? '，你（AI角色本人）赞过'
            : '';
      return memoryContentOf(
        {
          peerId: contact.id,
          platform: post.platform,
          postId: post.id,
          sourceTime,
          shape: 'user-post',
          peerDisplay,
          userName: ownerReal || post.authorName,
          // #18：转发动态的记忆 detail 同口径（原文摘要 + 理由），不是只有理由
          detail: post.repostOf ? repostContextText(post.repostOf, post.content, 30) : post.content.slice(0, 60),
          extra,
        },
        contactReal,
        ownerReal
      );
    }
    // 角色动态：主人=发帖人本人
    if (!isPostByPeer(post, contact)) return null;
    return memoryContentOf(
      {
        peerId: contact.id,
        platform: post.platform,
        postId: post.id,
        sourceTime,
        shape: 'char-post',
        peerDisplay,
        userName: ownerReal,
        // 四轮审计 L2 + #18：转发动态（不论原作者）记忆 detail 统一带被转发原文 + 理由——
        // 与 buildMomentsChatBlock 注入口径一致；只有转发理由会导致「记得转过、却不知道转的是什么」
        detail: post.repostOf
          ? repostContextText(post.repostOf, post.content, 30).slice(0, 120)
          : post.content.slice(0, 80),
      },
      contactReal,
      ownerReal
    );
  }
  if (kind === 'like') {
    // 形态一：机主赞了主人（动态作者）的动态（user-like，主人=动态作者）
    const userLike = post.likes.find((l) => l.author === 'user');
    if (userLike && isPostByPeer(post, contact)) {
      return memoryContentOf(
        {
          peerId: contact.id,
          platform: post.platform,
          postId: post.id,
          sourceTime,
          shape: 'user-like',
          peerDisplay,
          userName: userLike.name || ownerReal,
          detail: post.content.slice(0, 40),
          postDetail: post.content.slice(0, 40),
        },
        contactReal,
        ownerReal
      );
    }
    // 形态二：主人（角色）赞了别人的动态（like，主人=点赞人本人）
    const like = post.likes.find((l) => isInteractionByPeer(l, contact));
    if (!like) return null;
    const postAuthorPeerId = post.author === 'char' ? post.peerId ?? undefined : undefined;
    if (post.author === 'char' && !postAuthorPeerId) return null; // 发帖人无法定位 → 关系建立不了
    return memoryContentOf(
      {
        peerId: contact.id,
        platform: post.platform,
        postId: post.id,
        sourceTime,
        shape: 'like',
        peerDisplay,
        userName: ownerReal,
        detail: post.content.slice(0, 40),
        postDetail: post.content.slice(0, 40),
        postAuthorPeerId,
        postAuthorDisplay: post.authorName,
      },
      contactReal,
      ownerReal,
      { postAuthor: postAuthorPeerId ? realNameOf(postAuthorPeerId) : '' }
    );
  }
  if (comment && comment.author === 'char') {
    // 角色评论/回复：主人=评论人本人
    if (!isInteractionByPeer(comment, contact)) return null;
    const parent = comment.parentId ? (post.comments.find((c) => c.id === comment.parentId) ?? null) : null;
    const replyTargetPeerId = parent && parent.author === 'char' && parent.peerId ? parent.peerId : undefined;
    const postAuthorPeerId = post.author === 'char' ? post.peerId ?? undefined : undefined;
    if (post.author === 'char' && !postAuthorPeerId) return null; // 发帖人无法定位 → 关系建立不了
    return memoryContentOf(
      {
        peerId: contact.id,
        platform: post.platform,
        postId: post.id,
        commentId: comment.id,
        sourceTime,
        // 与写入口径一致：parentId 在 → 回复句式（被回复人默认机主，回复角色评论用 replyTargetPeerId 解析）
        shape: comment.parentId ? 'char-reply' : 'char-comment',
        peerDisplay,
        userName: ownerReal,
        detail: comment.content.slice(0, 40),
        postDetail: post.content.slice(0, 40),
        postAuthorPeerId,
        postAuthorDisplay: post.authorName,
        replyTargetPeerId,
        replyTargetDisplay: parent?.authorName,
      },
      contactReal,
      ownerReal,
      {
        postAuthor: postAuthorPeerId ? realNameOf(postAuthorPeerId) : '',
        replyTarget: replyTargetPeerId ? realNameOf(replyTargetPeerId) : '',
      }
    );
  }
  if (comment && comment.author === 'user') {
    const parent = comment.parentId ? (post.comments.find((c) => c.id === comment.parentId) ?? null) : null;
    if (parent && parent.author === 'char') {
      // 用户回复角色评论：合法主人=被回复的角色
      if (!isInteractionByPeer(parent, contact)) return null;
      return memoryContentOf(
        {
          peerId: contact.id,
          platform: post.platform,
          postId: post.id,
          commentId: comment.id,
          sourceTime,
          shape: 'user-reply',
          peerDisplay: parent.authorName,
          userName: comment.authorName || ownerReal,
          detail: comment.content.slice(0, 40),
          postDetail: post.content.slice(0, 40),
        },
        contactReal,
        ownerReal
      );
    }
    if (!comment.parentId) {
      // 用户顶层评论角色动态：合法主人=动态作者
      if (post.author !== 'char' || post.peerId !== contact.id) return null;
      return memoryContentOf(
        {
          peerId: contact.id,
          platform: post.platform,
          postId: post.id,
          commentId: comment.id,
          sourceTime,
          shape: 'user-comment',
          peerDisplay: post.authorName,
          userName: comment.authorName || ownerReal,
          detail: comment.content.slice(0, 40),
        },
        contactReal,
        ownerReal
      );
    }
  }
  return null; // 用户回复用户评论 / 悬空回复等：写入侧本就不产生记忆 → 无法生成（repair 保留不删）
}

/** 写入该角色的动态记忆核心（异步解析真实名字后调 expectedMomentMemoryOf 成句再入库）；
 *  可 await，供编辑正文等需要与清理串行的路径复用。关系建立不了（生成结果为空）时不写入（宁缺勿错） */
async function writeMomentMemoryFromData(args: {
  kind: 'post' | 'like' | 'comment';
  post: MomentPostView;
  comment: MomentCommentView | null;
  /** 记忆主人（AI 角色） */
  contact: Pick<ContactRecord, 'id' | 'name' | 'nickname'>;
  /** 机主展示名（真名解析失败的兜底） */
  userName: string;
}): Promise<void> {
  const { kind, post, comment, contact, userName } = args;
  if (!contact?.id) return;
  // 四轮审计 M2：落库前复核 peer 仍在册——删联系人后的迟到写入（异步真名解析窗口 / 调度器 stale 引用）
  // 不再向已清空的 mem-frag 键重写记忆碎片（宁缺勿错：联系人读取失败按不在册处理，跳过写入）
  if (!(await listContacts().catch(() => [] as ContactRecord[])).some((c) => c.id === contact.id)) return;
  // 多账号 v2：动态记忆按动态所属平台（wx/qq）的当前账号取「我」的真名（AccountApp 兼容）
  const [ownerReal, contactReal] = await Promise.all([ownerRealNameFor(post.platform), contactRealName(contact.id)]);
  // 关系人真名按需解析（动态归属人 / 被回复评论的作者）；主人本人的真名已随上一步解析
  const relationIds = new Set<string>();
  if (post.author === 'char' && post.peerId) relationIds.add(post.peerId);
  const parent = comment?.parentId ? (post.comments.find((c) => c.id === comment.parentId) ?? null) : null;
  if (parent && parent.author === 'char' && parent.peerId) relationIds.add(parent.peerId);
  const realNames = new Map<string, string>([[contact.id, contactReal]]);
  await Promise.all(
    [...relationIds].map(async (id) => {
      if (realNames.has(id)) return;
      realNames.set(id, await contactRealName(id));
    })
  );
  // 句式生成走单一事实源 expectedMomentMemoryOf（与 repair 同一函数），杜绝写入/纠错口径漂移
  const content = expectedMomentMemoryOf(kind, post, comment, contact, ownerReal, (id) => realNames.get(id) || '');
  if (!content || !content.trim()) return; // 关系解析失败 → 不写入
  memAddMomentFragment(
    contact.id,
    platformApp(post.platform),
    content,
    {
      postId: post.id,
      kind: kind === 'like' ? 'like' : kind === 'post' ? 'post' : 'comment',
      commentId: comment?.id,
    },
    momentFactSourceTimeOf(kind, post, comment, contact)
  );
}

/** 写入该角色的动态记忆：数据真实形态 → 真名异步解析 → 句式生成 → memAddMomentFragment（失败静默，不阻塞 UI）。
 *  关系无法建立（expectedMomentMemoryOf 返回 null）时不写入——宁缺勿错，绝不让错误关系进记忆 */
function writeMomentMemory(args: {
  kind: 'post' | 'like' | 'comment';
  post: MomentPostView;
  comment: MomentCommentView | null;
  contact: Pick<ContactRecord, 'id' | 'name' | 'nickname'>;
  userName: string;
}): void {
  if (!args.contact?.id) return;
  void writeMomentMemoryFromData(args).catch(() => {
    // 记忆是增强能力，失败静默
  });
}

// ---------------- 读写操作（UI 与调度器统一入口；每次变更后广播 moments-changed） ----------------

/** 用户发一条动态（广播：peerId=null；记忆由「看到它的角色」在互动/聊天时入库，见 buildMomentsChatBlock）。
 *  location = 位置名（可选）；repostOf = 转发引用（QQ 空间转发别人的动态时传） */
export function addUserMomentPost(
  platform: MomentPlatform,
  args: { userName: string; avatar: string | null; content: string; images?: string[]; location?: string; repostOf?: MomentRepostRef }
): MomentPostView {
  rememberMomentUserName(platform, args.userName);
  const post: MomentPostView = {
    id: uid(),
    platform,
    author: 'user',
    authorName: args.userName,
    avatar: args.avatar,
    peerId: null,
    content: args.content,
    images: args.images ?? [],
    location: args.location || undefined,
    repostOf: args.repostOf,
    createdAt: Date.now(),
    likes: [],
    comments: [],
  };
  const list = listMomentPosts(platform, args.userName);
  persistMomentPosts(platform, [post, ...list]);
  return post;
}

/**
 * 角色发一条动态（手动「让TA发一条」/ 自动发布共用；发布即写该角色记忆——三.3）。
 * writeMemory=false 用于示例动态补齐（不是真实的「TA 发了」，不入记忆）。
 * 四轮审计 M2：本函数保持同步签名（wechat/qq 首访播种示例动态是同步调用），存在性复核放在
 * 调用链上游（runAutoPosts 选定候选后 / aiPostMoment、aiRepostMoment 入口）+ 记忆层兜底
 * （writeMomentMemoryAwait 落库前复核），确保删联系人后的迟到触发不再产生幽灵动态/记忆。
 */
export function addCharMomentPost(
  platform: MomentPlatform,
  args: {
    peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>;
    userName: string;
    content: string;
    /** 双语译文（可选；写入 post.contentZh，旧调用方不传则无译文） */
    contentZh?: string;
    images?: string[];
    /** 「文字图片」卡片文字（AI 配图降级时传；点击可升级为真图，见 upgradeMomentTextCard） */
    textCard?: string;
    /** 位置名（可选） */
    location?: string;
    /** 转发引用（AI 转发用户动态时传；QQ 空间） */
    repostOf?: MomentRepostRef;
    /** 补示例动态时传（不入记忆） */
    writeMemory?: boolean;
    /** 示例动态的回溯时间 */
    createdAt?: number;
  }
): MomentPostView {
  rememberMomentUserName(platform, args.userName);
  const createdAt = args.createdAt ?? Date.now();
  const post: MomentPostView = {
    id: uid(),
    platform,
    author: 'char',
    authorName: displayNameOf(args.peer),
    // 引用式架构：头像不落快照，只存身份引用（peerId），渲染端 liveAvatarOf 实时取当前头像
    //（换头像后历史动态立刻换新；省去每条动态几百 KB 的 data URL 冗余）
    avatar: null,
    peerId: args.peer.id,
    content: args.content,
    contentZh: args.contentZh,
    images: args.images ?? [],
    textCard: args.textCard || undefined,
    location: args.location || undefined,
    repostOf: args.repostOf,
    createdAt,
    likes: [],
    comments: [],
  };
  const list = listMomentPosts(platform, args.userName);
  persistMomentPosts(platform, [post, ...list]);
  // 转发了用户的动态 → 给机主推一条「转发」互动消息（QQ 空间消息·转发分类）
  if (args.repostOf && args.repostOf.author === 'user') {
    pushMomentNotice(platform, {
      kind: 'repost',
      actorName: displayNameOf(args.peer),
      actorKind: 'char',
      actorPeerId: args.peer.id,
      // 引用式架构：互动消息不存头像快照，渲染端实时解析（同动态）
      actorAvatar: null,
      postId: args.repostOf.postId,
      postAuthorName: args.repostOf.authorName,
      postSummary: args.repostOf.content,
      postImage: args.repostOf.images[0] ?? null,
      content: args.content.slice(0, 80),
    });
  }
  if (args.writeMemory !== false) {
    // 句式走单一事实源 expectedMomentMemoryOf（与 repair 同一函数）：转发动态（不论原作者）detail
    // 统一带被转发原文 + 理由（repostContextText 口径，见 #18/四轮审计 L2）；非转发普通发帖保持原口径
    writeMomentMemory({ kind: 'post', post, comment: null, contact: args.peer, userName: args.userName });
  }
  return post;
}

/** 编辑动态内容（用户改动态；自己的和 AI 的都允许改——手机是用户的）。
 *  正文变了 → contentZh 旧译文清空（避免错位展示）；记忆同步：旧碎片里的句式嵌的还是旧正文，
 *  无法精确改写合并产物 → 宁缺勿错按 sourcePostId 整组清除，再按作者重写一条新句式
 *  （角色动态重写 char-post；用户广播动态没有唯一记忆主人，不重写——buildMomentsChatBlock
 *  懒写入会按新正文重建） */
export function updateMomentPostContent(platform: MomentPlatform, postId: string, userName: string, content: string): boolean {
  const list = listMomentPosts(platform, userName);
  const hit = list.find((p) => p.id === postId);
  const text = content.trim();
  if (!hit || !text) return false;
  const changed = hit.content !== text;
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, content: text, contentZh: changed ? undefined : p.contentZh } : p))
  );
  if (changed) {
    void (async () => {
      try {
        // 先清后写（串行避免清/写竞态把新碎片又清掉）：memPurgeMomentSources 按 sourcePostId 匹配，
        // 清掉该动态的全部旧碎片（含评论/点赞相关碎片——评论实体还在，只是旧句式记忆不再保留，宁缺勿错）
        const contacts = await listContacts();
        for (const c of contacts) memPurgeMomentSources(c.id, { postId });
        if (hit.author === 'char' && hit.peerId) {
          // 句式走单一事实源（expectedMomentMemoryOf）：转发动态的改写同样带被转发原文 + 理由；
          // 记忆时刻取动态创建时刻（与发帖写入/repair 重算口径一致，避免下次启动又被重算改写）
          await writeMomentMemoryFromData({
            kind: 'post',
            post: { ...hit, content: text },
            comment: null,
            contact: { id: hit.peerId, name: hit.authorName, nickname: null },
            userName,
          });
        }
      } catch {
        // 记忆同步是增强能力，失败静默
      }
    })();
  }
  return true;
}

/**
 * 级联清理该动态/评论在各角色记忆里留下的「动态来源」碎片（六.3：删了动态/评论，
 * AI 不该再在聊天里记得「你发过那条/我评论过那条」）。异步批量执行，不阻塞 UI。
 */
function purgeMomentMemories(filter: { postId: string; commentId?: string }): void {
  void (async () => {
    try {
      const contacts = await listContacts();
      for (const c of contacts) memPurgeMomentSources(c.id, filter);
    } catch {
      // 记忆清理是增强能力，失败静默
    }
  })();
}

/** 删除动态（含评论/点赞、队列里的相关待处理项、互动消息收件箱里的相关通知与各角色记忆里的相关碎片） */
export function deleteMomentPost(platform: MomentPlatform, postId: string, userName: string): boolean {
  const list = listMomentPosts(platform, userName);
  if (!list.some((p) => p.id === postId)) return false;
  persistMomentPosts(platform, list.filter((p) => p.id !== postId));
  try {
    const q = loadQueueSafe().filter((item) => item.postId !== postId);
    saveQueue(q);
  } catch {
    // 忽略
  }
  // 收件箱联动：该动态相关的互动消息（postId 悬空的赞/评/回复/转发通知）一并移除，不再计入未读角标
  try {
    const notices = loadNoticesSafe(platform);
    if (notices && notices.some((n) => n.postId === postId)) {
      saveNotices(platform, notices.filter((n) => n.postId !== postId));
    }
  } catch {
    // 忽略
  }
  purgeMomentMemories({ postId });
  return true;
}

/** 用户点赞/取消点赞。点赞 AI 的动态 → 给作者写一条 user-like 记忆（AI 能感知被赞，宁缺勿错同规：
 *  作者非角色或无法定位不写）；取消赞 → 精确清掉作者库里该动态的点赞来源记忆（不动该动态的其他记忆） */
export function toggleUserMomentLike(platform: MomentPlatform, postId: string, userName: string): void {
  rememberMomentUserName(platform, userName);
  const list = listMomentPosts(platform, userName);
  const post = list.find((p) => p.id === postId);
  persistMomentPosts(
    platform,
    list.map((p) => {
      if (p.id !== postId) return p;
      const liked = p.likes.some((l) => l.name === userName);
      return {
        ...p,
        likes: liked
          ? p.likes.filter((l) => l.name !== userName)
          : [...p.likes, { name: userName, author: 'user' as const, peerId: null, time: Date.now() }],
      };
    })
  );
  if (!post) return;
  const willLike = !post.likes.some((l) => l.name === userName);
  // 记忆主人 = 动态作者（角色且 peerId 可定位才写，宁缺勿错）；用户广播动态没有唯一主人，不入库
  if (post.author !== 'char' || !post.peerId) return;
  if (willLike) {
    // 句式走单一事实源 expectedMomentMemoryOf（与 repair 同一函数）：主人=动态作者本人；
    // #41g：记忆时刻 = 点赞发生时刻（点赞记录 time，句式生成器与碎片时间戳同口径）
    writeMomentMemory({
      kind: 'like',
      post,
      comment: null,
      contact: { id: post.peerId, name: post.authorName, nickname: null },
      userName,
    });
  } else {
    // 取消赞：只清该动态的「点赞」来源碎片（sourceKind==='like' 且无 commentId），
    // 不碰同库中该动态的其他记忆（如作者自己「发过这条动态」的 char-post 碎片）
    try {
      try {
        setMemScopeForApp(platformApp(platform)); // 多账号：按当前平台账号清（重启后ambient作用域可能是大号）
      } catch {
        // 作用域设置失败按调用方上下文
      }
      const likeFrags = listFragments(post.peerId).filter(
        (f) => f.source === 'moments' && f.sourcePostId === postId && f.sourceKind === 'like' && !f.sourceCommentId
      );
      if (likeFrags.length > 0) memDeleteFragmentByIds(post.peerId, likeFrags.map((f) => f.id));
    } catch {
      // 记忆清理是增强能力，失败静默
    }
  }
}

/** 角色点赞（调度器 AI 互动用；写入该角色记忆——三.4）。
 *  发帖人不能给自己的动态点赞（数据层硬性守卫）；角色动态但发帖人无法定位时不写记忆（宁缺勿错）。
 *  四轮审计 M2：落库前复核 peer 仍在新鲜联系人列表——已删除则静默 abort（不落库/不入收件箱/不写记忆） */
export async function addCharMomentLike(
  platform: MomentPlatform,
  postId: string,
  args: { peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>; userName: string }
): Promise<boolean> {
  if (!(await listContacts()).some((c) => c.id === args.peer.id)) return false;
  rememberMomentUserName(platform, args.userName);
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post || post.likes.some((l) => l.peerId === args.peer.id || l.name === displayNameOf(args.peer))) return false;
  // 发帖人不能互动自己的动态（防「AI 自己给自己点赞/评论」的历史 bug）
  if (isPostByPeer(post, args.peer)) return false;
  persistMomentPosts(
    platform,
    list.map((p) =>
      p.id === postId
        ? { ...p, likes: [...p.likes, { name: displayNameOf(args.peer), author: 'char' as const, peerId: args.peer.id, time: Date.now() }] }
        : p
    )
  );
  // 赞了机主的动态 → 推一条「赞」互动消息（与我的互动 / 空间消息·赞和推）
  if (post.author === 'user') {
    pushMomentNotice(platform, {
      kind: 'like',
      actorName: displayNameOf(args.peer),
      actorKind: 'char',
      actorPeerId: args.peer.id,
      // 引用式架构：互动消息不存头像快照，渲染端实时解析（同动态）
      actorAvatar: null,
      postId: post.id,
      postAuthorName: post.authorName,
      postSummary: post.content.slice(0, 60),
      postImage: post.images[0] ?? null,
      content: '',
    });
  }
  // 角色动态时记忆句式带真实发帖人（「X给乐乐的动态点了赞」而非错写到机主头上）；
  // 发帖人无法定位 → expectedMomentMemoryOf 返回 null → 自然跳过（不写错误关系）。
  // #41g：记忆时刻 = 互动发生时刻（点赞记录 time，句式生成器与碎片时间戳同口径）
  writeMomentMemory({ kind: 'like', post, comment: null, contact: args.peer, userName: args.userName });
  return true;
}

/**
 * 用户评论（replyTo 传被回复评论的 id+名字，可多轮）。
 * 记忆写入规则（三.2）：评论对象能落到具体角色时（评论的是角色的动态 / 回复的是角色的评论），
 * 给该角色写一条 source='moments' 的记忆；纯广播动态下的独立评论没有唯一受众，不入库
 * （聊天时由注入块兜底呈现）。若被回复方是 AI 角色，自动排一条 AI 回复进队列（二.3 多轮）。
 * 返回新评论（未找到目标动态返回 null）。
 */
export function addUserMomentComment(
  platform: MomentPlatform,
  postId: string,
  args: { userName: string; content: string; replyTo?: { commentId?: string | null; name?: string | null } }
): MomentCommentView | null {
  rememberMomentUserName(platform, args.userName);
  const text = args.content.trim();
  if (!text) return null;
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post) return null;
  const replyToId = args.replyTo?.commentId ?? null;
  const parent = replyToId ? (post.comments.find((c) => c.id === replyToId) ?? null) : null;
  // #41e：带回复目标但目标评论已不存在（被删/悬空）→ 不再降级：不挂「回复X」、不回落动态作者
  // 排队回复、不写回落记忆（宁缺勿错；收件箱入口已在 UI 侧挡掉已删评论的回复框）。
  // 评论本体仍照常落库为独立顶层评论（用户输入不丢，只是失去回复语义）
  const replyTargetMissing = replyToId !== null && parent === null;
  const replyToName = parent ? parent.authorName : null;
  const comment: MomentCommentView = {
    id: uid(),
    author: 'user',
    authorName: args.userName,
    peerId: null,
    content: text,
    createdAt: Date.now(),
    parentId: parent ? parent.id : null,
    replyToName,
  };
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, comment] } : p))
  );
  // 记忆对象：回复的角色评论 → 那个角色；评论角色本人的动态 → 那个角色；
  // 回复目标已失效 → 不回落动态作者（#41e 宁缺勿错，直接跳过该项记忆）
  const targetPeerId = replyTargetMissing
    ? null
    : parent
      ? parent.peerId
      : post.author === 'char'
        ? post.peerId
        : null;
  if (targetPeerId) {
    // 句式与合法主人校验走单一事实源 expectedMomentMemoryOf（与 repair 同一函数）：
    // 回复角色评论 → user-reply（主人=被回复的角色）；顶层评论 → user-comment（主人=动态作者）。
    // #41g：记忆时刻 = 评论/回复发生时刻（评论记录 createdAt，句式生成器与碎片时间戳同口径）
    writeMomentMemory({
      kind: 'comment',
      post,
      comment,
      contact: { id: targetPeerId, name: parent?.authorName ?? post.authorName, nickname: null },
      userName: args.userName,
    });
  }
  // AI 回复排队（二.1/二.3）：回复的是 AI 的评论 → 那个 AI 来回（多轮）；
  // 顶层评论的是角色本人的动态 → 动态作者也来回复用户（AI 发的动态，用户评论后 TA 会回）。
  // 队列里带「用户的这条评论」id（不是 AI 的父评论）：AI 的是在回复用户这句话，
  // replyTo 展示名/prompt 指代才会是用户（而非 AI 自己），parentId 也串在用户评论下
  const replyPeerId = replyTargetMissing
    ? null // 回复目标已失效 → 不回落动态作者排队回复（#41e：宁缺勿错，直接跳过该项）
    : parent
      ? parent.author === 'char'
        ? parent.peerId
        : null
      : post.author === 'char'
        ? post.peerId
        : null;
  if (replyPeerId) {
    enqueueCharReply(platform, postId, replyPeerId, comment.id, args.userName);
  }
  return comment;
}

/**
 * 角色评论/回复（AI 互动与 AI 回复共用；写入该角色记忆——三.4）。
 * 防重复（一.4）：同一条动态下已有一模一样的内容（任何人发的）→ 拒绝写入。
 * 身份硬性守卫：发帖人不能评论自己的动态（旧版「AI 自己给自己评论」bug 的数据层防线）。
 * 记忆关系（修复）：评论/回复角色动态时，句式归属人用真实发帖人（「陈默评论了乐乐的动态」），
 * 不再硬编码机主；关系无法建立时不写入（宁缺勿错）。
 * 四轮审计 M2：落库前复核 peer 仍在新鲜联系人列表——已删除则静默 abort（不落库/不入收件箱/不写记忆）。
 */
export async function addCharMomentComment(
  platform: MomentPlatform,
  postId: string,
  args: {
    peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>;
    userName: string;
    content: string;
    /** 双语译文（可选；写入 comment.contentZh） */
    contentZh?: string;
    /** 回复目标（用户或角色的评论 id+名字） */
    replyTo?: { commentId: string; name: string } | null;
    writeMemory?: boolean;
  }
): Promise<MomentCommentView | null> {
  if (!(await listContacts()).some((c) => c.id === args.peer.id)) return null;
  rememberMomentUserName(platform, args.userName);
  const text = args.content.trim();
  if (!text) return null;
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post) return null;
  if (post.comments.some((c) => c.content.trim() === text)) return null; // 已有一模一样的内容 → 不重复写入
  // 回复目标解析（#41d）：必须是「真实存在于 post.comments 的用户评论」才算有效回复——
  // 悬空 replyTo（目标评论已删/不存在）与非用户评论一律视同无 replyTo，
  // 否则作者可借悬空 replyTo 绕过下方防自评守卫（parent 查不到=照防自评拦截）
  const parent = args.replyTo?.commentId
    ? (post.comments.find((c) => c.id === args.replyTo?.commentId && c.author === 'user') ?? null)
    : null;
  // 发帖人不能「主动评论」自己的动态（防「AI 自己给自己评论」的历史 bug）；
  // 带「有效回复目标（用户评论）」的放行：作者回复用户在自己动态下的评论是正常互动
  // （引擎层 drainReplies 已保证只回用户的评论；收件箱多轮回复链路的 parent 都是用户评论，不受影响）
  if (!parent && isPostByPeer(post, args.peer)) return null;
  const comment: MomentCommentView = {
    id: uid(),
    author: 'char',
    authorName: displayNameOf(args.peer),
    peerId: args.peer.id,
    content: text,
    contentZh: args.contentZh,
    createdAt: Date.now(),
    // #41d：parentId/replyToName 只从「解析成功的真实 parent」取（悬空 replyTo 不再写入悬挂指向）
    parentId: parent?.id ?? null,
    replyToName: parent?.authorName ?? null,
  };
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, comment] } : p))
  );
  // 互动消息：评论了机主的动态 / 回复了机主的评论（不论原动态是谁发的）→ 推一条消息
  const parentIsUserComment = parent?.author === 'user';
  if (post.author === 'user' || parentIsUserComment) {
    pushMomentNotice(platform, {
      kind: parent ? 'reply' : 'comment',
      actorName: displayNameOf(args.peer),
      actorKind: 'char',
      actorPeerId: args.peer.id,
      // 引用式架构：互动消息不存头像快照，渲染端实时解析（同动态）
      actorAvatar: null,
      postId: post.id,
      postAuthorName: post.authorName,
      postSummary: post.content.slice(0, 60),
      postImage: post.images[0] ?? null,
      commentId: comment.id,
      replyToName: parent ? parent.authorName : null,
      content: text.slice(0, 80),
    });
  }
  if (args.writeMemory !== false) {
    // 句式与归属关系走单一事实源 expectedMomentMemoryOf（与 repair 同一函数）：
    // 归属人：角色动态 → 真实发帖人；发帖人无法定位（legacy 无 peerId）→ 关系建立不了，不写记忆（宁缺勿错）。
    // #41d/#41g：shape 只看解析成功的 parent（悬空 replyTo 视同无 replyTo → 归为独立评论句式）；
    // 记忆时刻 = 评论/回复发生时刻（评论记录 createdAt，句式生成器与碎片时间戳同口径）
    writeMomentMemory({ kind: 'comment', post, comment, contact: args.peer, userName: args.userName });
  }
  return comment;
}

/** 删除一条评论（长按删除；任何人的评论都可删——手机是用户的。其下全部后代回复、相关队列回复与记忆碎片一并清掉） */
export function deleteMomentComment(platform: MomentPlatform, postId: string, commentId: string, userName: string): boolean {
  const list = listMomentPosts(platform, userName);
  const post = list.find((p) => p.id === postId);
  if (!post || !post.comments.some((c) => c.id === commentId)) return false;
  // 递归收集全部后代评论（回复的回复…）一并删除
  const removed = new Set<string>([commentId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of post.comments) {
      if (c.parentId && removed.has(c.parentId) && !removed.has(c.id)) {
        removed.add(c.id);
        grew = true;
      }
    }
  }
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: p.comments.filter((c) => !removed.has(c.id)) } : p))
  );
  try {
    const q = loadQueueSafe().filter((item) => item.type !== 'reply' || !removed.has(item.parentCommentId));
    saveQueue(q);
  } catch {
    // 忽略
  }
  // 后代回复的记忆碎片一并清：memPurgeMomentSources 按 sourceCommentId 精确匹配，逐个传（含根评论）
  for (const cid of removed) purgeMomentMemories({ postId, commentId: cid });
  // 收件箱联动：被删评论（含后代回复）相关的互动消息（postId+commentId 匹配）一并移除，不再计未读
  try {
    const notices = loadNoticesSafe(platform);
    if (notices && notices.some((n) => n.postId === postId && n.commentId && removed.has(n.commentId))) {
      saveNotices(platform, notices.filter((n) => !(n.postId === postId && n.commentId && removed.has(n.commentId))));
    }
  } catch {
    // 忽略
  }
  return true;
}

// ---------------- 延迟队列（AI 互动 / AI 回复；持久化，重启不丢） ----------------

interface MomentQueueInteract {
  type: 'interact';
  id: string;
  platform: MomentPlatform;
  postId: string;
  fireAt: number;
  tries: number;
  /** 结算失败重试计数（生成全失败/零互动产生时顺延重试，最多 2 次，第三次失败才丢弃） */
  attempts?: number;
}
interface MomentQueueReply {
  type: 'reply';
  id: string;
  platform: MomentPlatform;
  postId: string;
  peerId: string;
  parentCommentId: string;
  /** 触发本次回复的机主展示名（生成 prompt 用） */
  userName: string;
  fireAt: number;
  tries: number;
}
type MomentQueueItem = MomentQueueInteract | MomentQueueReply;

/** 读队列原始形状：键不存在/形状不对返回 null（区别于「空队列」，tick 合并写回 #1 用） */
function loadQueueOrNull(): MomentQueueItem[] | null {
  try {
    const raw = kvGet<MomentQueueItem[]>(QUEUE_KEY);
    if (!Array.isArray(raw)) return null;
    return raw.filter(
      (x): x is MomentQueueItem =>
        Boolean(x) &&
        typeof x === 'object' &&
        (x.type === 'interact' || x.type === 'reply') &&
        typeof x.postId === 'string' &&
        isMomentPlatform(x.platform)
    );
  } catch {
    return null;
  }
}

function loadQueueSafe(): MomentQueueItem[] {
  return loadQueueOrNull() ?? [];
}

function saveQueue(list: MomentQueueItem[]): void {
  try {
    // #41f：容量上限 40 → 200。#17：按 fireAt 升序排序后保留「最先到期」的前 200 条——
    // 旧版升序后 slice(-200) 截掉的恰是最小 fireAt（最先该结算的项），方向反了：
    // 队列积压时越紧急的项越先被丢、新入队的紧急项反而永不结算
    const capped = [...list].sort((a, b) => (a.fireAt || 0) - (b.fireAt || 0)).slice(0, 200);
    kvSet(QUEUE_KEY, capped);
  } catch {
    // 忽略
  }
}

/** 用户/角色发了新动态：延迟（默认 firstCommentDelay 秒）后由调度结算（1-2 位平台好友来点赞/评论，像真人刷到） */
export function enqueuePostInteractions(
  platform: MomentPlatform,
  postId: string,
  /** 显式指定延迟秒数（如 aiPostMoment 用 npcInteractDelay 触发 NPC 互动）；省略则用 settings.firstCommentDelay */
  delaySec?: number
): void {
  // feat-64：设置按平台独立（朋友圈/空间各一份）
  const settings = getMomentsSettings(platform);
  const delay = (delaySec ?? settings.firstCommentDelay) * 1000;
  const q = loadQueueSafe();
  if (q.some((x) => x.type === 'interact' && x.postId === postId)) return;
  q.push({
    type: 'interact',
    id: uid(),
    platform,
    postId,
    fireAt: Date.now() + delay,
    tries: 0,
  });
  saveQueue(q);
}

/** 用户/NPC 回复了 AI 的评论：延迟（followCommentDelay / replyNpcCommentDelay 秒）后生成 AI 的再回复（多轮互动） */
export function enqueueCharReply(
  platform: MomentPlatform,
  postId: string,
  peerId: string,
  parentCommentId: string,
  userName: string,
  kind: 'user' | 'npc' = 'user'
): void {
  // feat-64：设置按平台独立（朋友圈/空间各一份）
  const settings = getMomentsSettings(platform);
  const delaySec = kind === 'npc' ? settings.replyNpcCommentDelay : settings.followCommentDelay;
  const delay = delaySec * 1000;
  const q = loadQueueSafe();
  if (q.some((x) => x.type === 'reply' && x.parentCommentId === parentCommentId)) return;
  q.push({
    type: 'reply',
    id: uid(),
    platform,
    postId,
    peerId,
    parentCommentId,
    userName,
    fireAt: Date.now() + delay,
    tries: 0,
  });
  saveQueue(q);
}

// ---------------- 自动发布设置（每角色 × 每平台） ----------------

export interface MomentAutoCfg {
  /** 自动发动态总开关 */
  enabled: boolean;
  /** 触发方式（一.6 三选一）：定时 / 频率 / 聊天灵感（基于最近聊天和记忆有感而发） */
  trigger: 'schedule' | 'interval' | 'chat';
  /** schedule 模式：每天 HH:mm */
  hh: number;
  mm: number;
  /** interval 模式：每隔 N 小时 */
  intervalHours: number;
}

/** 默认开启：每位好友都会一直主动发动态（聊天后有感而发），可在每好友设置里单独关闭 */
export const DEFAULT_MOMENT_AUTO_CFG: MomentAutoCfg = {
  enabled: true,
  trigger: 'chat',
  hh: 21,
  mm: 0,
  intervalHours: 24,
};

export const MOMENT_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72];

function loadAutoCfgMap(): Record<string, MomentAutoCfg> {
  try {
    const raw = kvGet<Record<string, MomentAutoCfg>>(AUTO_CFG_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

const cfgKeyOf = (contactId: string, platform: MomentPlatform) => `${contactId}:${platform}`;

export function getMomentAutoCfg(contactId: string, platform: MomentPlatform): MomentAutoCfg {
  const raw = loadAutoCfgMap()[cfgKeyOf(contactId, platform)];
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MOMENT_AUTO_CFG };
  return {
    // 缺省（历史数据未写过 enabled）跟随新默认 true；显式 false（用户手动关过）保持关闭
    enabled: raw.enabled !== false,
    trigger: raw.trigger === 'interval' || raw.trigger === 'schedule' ? raw.trigger : 'chat',
    hh: typeof raw.hh === 'number' && raw.hh >= 0 && raw.hh <= 23 ? Math.floor(raw.hh) : DEFAULT_MOMENT_AUTO_CFG.hh,
    mm: typeof raw.mm === 'number' && raw.mm >= 0 && raw.mm <= 59 ? Math.floor(raw.mm) : DEFAULT_MOMENT_AUTO_CFG.mm,
    intervalHours: MOMENT_INTERVAL_OPTIONS.includes(raw.intervalHours)
      ? raw.intervalHours
      : DEFAULT_MOMENT_AUTO_CFG.intervalHours,
  };
}

export function saveMomentAutoCfg(contactId: string, platform: MomentPlatform, patch: Partial<MomentAutoCfg>): MomentAutoCfg {
  const map = loadAutoCfgMap();
  const next: MomentAutoCfg = { ...getMomentAutoCfg(contactId, platform), ...patch };
  map[cfgKeyOf(contactId, platform)] = next;
  try {
    kvSet(AUTO_CFG_KEY, map);
  } catch {
    // 忽略
  }
  return next;
}

/** 该角色在某平台是否【显式配置过】自动发帖（区分「用户设置过」与「走默认」；分支继承用，Task 38-4A） */
export function hasMomentAutoCfgEntry(contactId: string, platform: MomentPlatform): boolean {
  try {
    const v = loadAutoCfgMap()[cfgKeyOf(contactId, platform)];
    return !!v && typeof v === 'object';
  } catch {
    return false;
  }
}

// ---------------- AI 生成（走 /api/moments/generate；用户 API 配置优先，服务端 SDK 兜底） ----------------

function personaOf(peer: ContactRecord): Record<string, string | null> {
  return {
    name: peer.name,
    nickname: peer.nickname ?? null,
    gender: peer.gender ?? null,
    age: peer.age ?? null,
    occupation: peer.occupation ?? null,
    company: peer.company ?? null,
    region: peer.region ?? null,
    persona: peer.persona ?? null,
    background: peer.background ?? null,
    expressStyle: peer.expressStyle ?? null,
    customRules: peer.customRules ?? null,
    relation: peer.relation ?? null,
    relationToUser: peer.relationToUser ?? null,
    kind: peer.kind ?? null,
  };
}

async function callGenerateApi(
  apiConfig: ApiConfig,
  payload: Record<string, unknown>
): Promise<{ content: string; contentZh: string }> {
  const res = await fetch('/api/moments/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, config: apiConfig }),
  });
  const data = (await res.json().catch(() => ({}))) as { content?: unknown; contentZh?: unknown; error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（${res.status}）`);
  if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('生成结果为空');
  return {
    content: data.content.trim().slice(0, 500),
    contentZh: typeof data.contentZh === 'string' ? data.contentZh.trim().slice(0, 500) : '',
  };
}

/** 文本去重归一：去空白/标点/符号、转小写——判定「内容完全一致（除标点外）」用 */
function normalizeForDupText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

/** 是否与禁复读列表里的某条「完全一致或高度雷同」（完全相等，或较长相互包含） */
function isDupText(text: string, avoid: string[]): boolean {
  const t = normalizeForDupText(text);
  if (!t) return false;
  return avoid.some((a) => {
    const n = normalizeForDupText(a);
    if (!n) return false;
    if (n === t) return true;
    // 一方明显更长且完整包含另一方（≥12 字才判雷同，避免短评“哈哈哈”误伤）
    return Math.min(n.length, t.length) >= 12 && (n.includes(t) || t.includes(n));
  });
}

/**
 * 随机切入角度（每次生成都随机指定一个，让同样的 prompt 基础每次产出不同方向的内容——
 * 同一角色在微信/QQ 两平台、甚至两次触发之间，内容不再一字不差）。
 */
const VARIATION_ANGLES_COMMENT: string[] = [
  '从这条动态里挑一个具体的细节追问或调侃',
  '用你们关系里的梗接话，损友式拆台',
  '带点情绪地反应（羡慕/吃醋/不服气/幸灾乐祸任选其一）',
  '顺势分享一句你自己相关的近况来呼应',
  '故意唱反调或认真吐槽一句',
  '只回一句简短但扎心/好笑的神回复',
  '关心式地追问后续（像真的好奇结果）',
  '顺着动态内容开一个玩笑或抖个机灵',
];
// 回复专用角度：围绕「被回复的那句话」接话——评论场景的角度（挑动态细节等）用在回复上
// 会把模型拉回动态本身，导致「回复不搭评论、复读自己的动态」（用户实锤）
const VARIATION_ANGLES_REPLY: string[] = [
  '直接回应对方话里的情绪（把TA的关心/调侃/疑问接住）',
  '顺着对方的话头自然补一句近况或想法',
  '向对方抛一个轻松的反问，把话递回去',
  '简短地认怂或自嘲一句',
  '带点得意或撒娇的口吻回应TA',
  '用你们关系里的梗接TA这句话',
  '爽快答应/拒绝TA话里的事，再加半句理由',
  '对TA这句评价给一个出人意料的反应',
];
const VARIATION_ANGLES_POST: string[] = [
  '写今天遇到的一件具体小事',
  '写此刻的心情（结合当下的时间/天气/场景）',
  '写工作或生活里的一点小感慨',
  '写最近在折腾的一件事（吃的/剧/游戏/运动都行）',
  '对某个日常场景发一句吐槽',
  '写一个突然冒出来的念头',
];
function randomVariation(kind: 'post' | 'comment' | 'reply'): string {
  const pool = kind === 'post' ? VARIATION_ANGLES_POST : kind === 'reply' ? VARIATION_ANGLES_REPLY : VARIATION_ANGLES_COMMENT;
  return pool[Math.floor(Math.random() * pool.length)] ?? '';
}

function agoLabelOf(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `${mins}分钟前`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.round(h / 24)}天前`;
}

/**
 * 该角色最近发过的原创动态（跨微信/QQ 两平台，新→旧）：
 * 喂给发动态 prompt——同一角色是「同一段连续生活」，新动态不能与自己已发的重复或矛盾
 * （修复「同一角色同时发了多条前后矛盾的动态」）。
 */
function ownRecentPostsOf(peerId: string, limit = 6): { label: string; raw: string }[] {
  const out: { platform: MomentPlatform; content: string; createdAt: number }[] = [];
  for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
    for (const p of listMomentPosts(platform)) {
      if (p.author !== 'char' || p.peerId !== peerId || p.repostOf) continue;
      out.push({ platform, content: p.content, createdAt: p.createdAt });
    }
  }
  return out
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((p) => ({
      label: `「${p.content.slice(0, 60)}」（${agoLabelOf(p.createdAt)}发在${MOMENT_PLATFORM_LABEL[p.platform]}）`,
      raw: p.content,
    }));
}

/**
 * 该角色最近说过的所有话（评论 + 转发理由，跨两平台，新→旧，去重）：
 * 喂给评论/回复/转发的 prompt 作禁复读名单——同一条动态在微信和 QQ 里的评论必须不同，
 * 一个字都不能与 TA 最近说过的话完全一致（修复「QQ 和微信的评论一字不差」）。
 */
function recentSelfTextsOf(peerId: string, limit = 8): string[] {
  const items: { text: string; createdAt: number }[] = [];
  for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
    for (const p of listMomentPosts(platform)) {
      if (p.author === 'char' && p.peerId === peerId && p.repostOf) {
        items.push({ text: p.content, createdAt: p.createdAt });
      }
      for (const c of p.comments) {
        if (c.author !== 'char' || c.peerId !== peerId) continue;
        items.push({ text: c.content, createdAt: c.createdAt });
      }
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items.sort((a, b) => b.createdAt - a.createdAt)) {
    const t = it.text.trim();
    if (!t) continue;
    const key = normalizeForDupText(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, 60));
    if (out.length >= limit) break;
  }
  return out;
}

/** 记忆素材：该角色最近的活跃记忆——优先取「当前 App」的记忆（评论/发动态要基于该 App 的上下文），
 *  同 App 记忆不足 3 条时再混入其他 App 的记忆补齐（微信和 QQ 的素材池因此天然不同）。
 *  多账号（用户规则二.3）：读前显式把记忆作用域切到该平台当前账号——调度器/AI 发帖可能在
 *  没有任何聊天召回的时机触发，不显式设置会沿用上次作用域（重启后=大号）→ 小号场景误读大号记忆。 */
function memorySnippets(contactId: string, app?: MemApp, limit = 8): string[] {
  if (app) {
    try {
      setMemScopeForApp(app);
    } catch {
      // 作用域设置失败按调用方上下文（与旧行为一致）
    }
  }
  const all = listFragments(contactId).filter((f) => !f.supersededAt && !f.expiredAt);
  let picked = all;
  if (app) {
    const inApp = all.filter((f) => f.app === app);
    if (inApp.length >= Math.min(3, limit)) {
      picked = inApp;
    } else {
      const seen = new Set(inApp.map((f) => f.content.trim()));
      picked = [...inApp, ...all.filter((f) => f.app !== app && !seen.has(f.content.trim()))];
    }
  }
  return picked.slice(0, limit).map((f) => f.content.replace(/\s+/g, ' ').slice(0, 60));
}

/**
 * AI 以该角色人设发一条动态（一.1/一.4/一.5：内容基于 persona + 最近聊天 + 记忆，随角色风格变化）。
 * 失败抛错（调用方 toast / 调度器退避）。
 */
export async function aiPostMoment(args: {
  apiConfig: ApiConfig;
  platform: MomentPlatform;
  peer: ContactRecord;
  userName: string;
  /** 聊天灵感触发时带的提示（让内容与最近话题呼应） */
  hint?: string;
}): Promise<MomentPostView> {
  const { apiConfig, platform, peer, userName, hint } = args;
  // 四轮审计 M2：生成/落库前复核 peer 仍在册——删联系人后的迟到触发直接中止
  //（不落库、不入收件箱、不写记忆；手动「让TA发一条」入口恒在册不受影响）
  if (!(await listContacts()).some((c) => c.id === peer.id)) throw new Error('联系人已删除，取消发帖');
  // feat-64：设置按平台独立（朋友圈/空间各一份）
  const settings = getMomentsSettings(platform);
  const recentChat = memRecentConvo(peer.id, platformApp(platform))
    .slice(-10)
    .map((t) => ({ role: t.role, text: t.text }));
  // 反自相矛盾素材：TA 最近在两个平台发过的全部原创动态（新动态不得与之重复/矛盾——同一个人是连续的生活）
  const ownPosts = ownRecentPostsOf(peer.id);
  const ownRaw = ownPosts.map((p) => p.raw);
  // 生成后去重重试：与已发动态一字不差 → 带禁令重试一次；仍重复则放弃（调度器退避后重来）
  let banned = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content, contentZh } = await callGenerateApi(apiConfig, {
      kind: 'post',
      platform,
      userName,
      peer: personaOf(peer),
      recentChat,
      memories: memorySnippets(peer.id, platformApp(platform)),
      ownRecentPosts: ownPosts.map((p) => p.label),
      avoid: banned ? [banned] : [],
      variation: randomVariation('post'),
      hint: hint ?? null,
      bilingual: settings.bilingualEnabled,
      bilingualPrompt: settings.bilingualPrompt || DEFAULT_BILINGUAL_PROMPT,
    });
    if (!isDupText(content, ownRaw)) {
      // 配图管线（与聊天 [图片:…] 同款协议）：从正文剥出照片标签——
      // 生图配置完整 → 锁脸生成真实照片（按角色 id 读参考图/外貌描述）；
      // 未配置/配置不完整/生成失败 → 降级为「文字图片」卡片（画面描述印在卡片上充当配图，点击可升级为真图）。
      // AI 无需关心最终收到的是真图还是卡片；剥离后正文为空（模型只发了标签）时用描述兜底当正文。
      const { text: stripped, tags } = extractPhotoTags(content);
      const finalText = stripped.trim();
      let images: string[] | undefined;
      let textCard: string | undefined;
      if (tags.length > 0) {
        // 一条动态最多一张配图是提示词明确教过的产品规则（见 generate 路由「配图要有节制」）。
        // 模型异常输出多标签时：剥除即可（帖子无「失信语境」，静默剥除可接受），
        // 多余标签丢弃不影响正文——extractPhotoTags 已把全部标签从正文剥离干净，这里只取第一张用。
        const tag = tags[0];
        const cfg = useSettings.getState().imgGenConfig;
        if (cfg.enabled && imgGenConfigReady(cfg)) {
          try {
            const r = await generateCharacterPhoto({
              cfg,
              contactId: peer.id,
              desc: tag.desc,
              charName: displayNameOf(peer),
              useRef: tag.useRef,
            });
            images = [r.src];
            // 相册挂点：真图生成成功 → 同步写入该角色的 AI 相册（contactId 恒非空，防御性守卫）
            if (peer.id) void addAlbum(peer.id, r.src, { desc: tag.desc, origin: 'ai' });
          } catch {
            textCard = tag.desc;
          }
        } else {
          textCard = tag.desc;
        }
      }
      const post = addCharMomentPost(platform, {
        peer,
        userName,
        content: finalText || tags[0]?.desc?.trim() || content,
        contentZh: contentZh || undefined,
        images,
        textCard,
      });
      // NPC 互动：角色发完动态后，其他 NPC 好友延迟（npcInteractDelay 秒）来点赞/评论
      enqueuePostInteractions(platform, post.id, settings.npcInteractDelay);
      return post;
    }
    banned = content;
  }
  throw new Error('动态与最近发过的内容重复');
}

/**
 * 点击动态里的「文字图片」卡片 → 用图像生成把它升级为真实照片（原位替换，持久化，广播刷新）。
 * 聊天端 TextCardActionSheet「生成图片」同口径：读设置 imgGenConfig（未配置/生成失败 → 返回错误信息）。
 * 照片按角色锁脸（post.peerId 读参考图/外貌描述；legacy 无 peerId 时无锁脸生成纯描述图）。
 * desc 可选：传非空时用它作为生图描述（生成前可改描述，与聊天端同口径），否则回落卡片文字 hit.textCard；
 * 升级成功时把实际使用的描述存进 textCardDesc 并打上 textCardUpgraded 标记（供重新生成预填/资格判定，见 regenerateMomentImage）。
 */
export async function upgradeMomentTextCard(
  platform: MomentPlatform,
  postId: string,
  userName: string,
  desc?: string
): Promise<{ ok: boolean; error?: string }> {
  const cfg = useSettings.getState().imgGenConfig;
  if (!cfg.enabled || !imgGenConfigReady(cfg)) {
    return { ok: false, error: '请先在 设置 › 图像生成 完成配置' };
  }
  const list = listMomentPosts(platform, userName);
  const hit = list.find((p) => p.id === postId);
  if (!hit || !hit.textCard) return { ok: false, error: '找不到这张卡片' };
  // 生图描述：自定义描述（trim 非空）优先，否则用卡片文字
  const finalDesc = (desc ?? '').trim() || hit.textCard;
  try {
    const r = await generateCharacterPhoto({
      cfg,
      contactId: hit.peerId ?? '',
      desc: finalDesc,
      charName: hit.authorName,
      useRef: true,
    });
    persistMomentPosts(
      platform,
      list.map((p) =>
        p.id === postId
          ? { ...p, textCard: undefined, images: [r.src], textCardUpgraded: true, textCardDesc: finalDesc }
          : p
      )
    );
    // 相册挂点：升级成功的真图同步写入该角色的 AI 相册（contactId 为空则跳过）
    if (hit.peerId) void addAlbum(hit.peerId, r.src, { desc: finalDesc, origin: 'ai' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : '生成失败，请稍后再试' };
  }
}

/**
 * 重新生成已升级为真图的「文字图片」卡片照片（原位替换 images[0]，持久化，广播刷新）。
 * 资格：帖子存在 + textCardUpgraded===true + images 非空（卡片未升级/已是纯图动态均不可走此入口）。
 * desc 为本次输入的画面描述；trim 后为空则回落上次使用的 textCardDesc（两者都空返回错误）。
 * 锁脸口径与 upgradeMomentTextCard 完全一致（post.peerId 读参考图/外貌描述，legacy 无 peerId 无锁脸）；
 * 成功后原位替换 images[0]、更新 textCardDesc，并把新图写入角色 AI 相册。
 */
export async function regenerateMomentImage(
  platform: MomentPlatform,
  postId: string,
  userName: string,
  desc: string
): Promise<{ ok: boolean; error?: string }> {
  const cfg = useSettings.getState().imgGenConfig;
  if (!cfg.enabled || !imgGenConfigReady(cfg)) {
    return { ok: false, error: '请先在 设置 › 图像生成 完成配置' };
  }
  const list = listMomentPosts(platform, userName);
  const hit = list.find((p) => p.id === postId);
  if (!hit || hit.textCardUpgraded !== true || hit.images.length === 0) {
    return { ok: false, error: '找不到可重新生成的照片' };
  }
  const finalDesc = desc.trim() || (hit.textCardDesc ?? '').trim();
  if (!finalDesc) return { ok: false, error: '缺少画面描述' };
  try {
    const r = await generateCharacterPhoto({
      cfg,
      contactId: hit.peerId ?? '',
      desc: finalDesc,
      charName: hit.authorName,
      useRef: true,
    });
    persistMomentPosts(
      platform,
      list.map((p) => (p.id === postId ? { ...p, images: [r.src], textCardDesc: finalDesc } : p))
    );
    // 相册挂点：重新生成的成图同样入相册（contactId 为空则跳过）
    if (hit.peerId) void addAlbum(hit.peerId, r.src, { desc: finalDesc, origin: 'ai' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : '生成失败，请稍后再试' };
  }
}

/**
 * #18：转发动态（QQ 手动转发为主路径 / AI 转发）的统一文本口径。
 * 转发动态的正文只是「转发理由」，被转发的原文摘要才是理解这条动态的关键——
 * AI 评论素材、聊天注入块、记忆 detail 三处共用本函数，保证对转发动态的理解一致：
 *   「转发@原作者：<原文摘要（截 80 字）>｜理由：<转发理由（截 reasonLimit 字）>」
 * 原动态纯图无文字时注明，防 AI 把转发理由当成原动态正文去评论；
 * 无原文摘要也无理由时返回空串（调用方按无事可做处理）。
 */
function repostContextText(ref: MomentRepostRef, reason: string, reasonLimit: number): string {
  const author = ref.authorName || '原作者';
  const summary = ref.content.trim().slice(0, 80);
  const refPart = summary
    ? `转发@${author}：${summary}`
    : ref.images.length > 0
      ? `转发@${author}：（原动态仅配图无文字）`
      : '';
  const reasonPart = reason.trim().slice(0, reasonLimit);
  if (!refPart) return reasonPart;
  return reasonPart ? `${refPart}｜理由：${reasonPart}` : refPart;
}

/** AI 给用户的动态写一条评论/回复（二.1/二.3；内容贴合人设、动态内容与记忆——不与已知事实矛盾）。
 *  发帖人不能评论自己的动态（引擎层守卫，把问题拦截在调 LLM 之前） */
export async function aiCommentOnMoment(args: {
  apiConfig: ApiConfig;
  platform: MomentPlatform;
  peer: ContactRecord;
  post: MomentPostView;
  userName: string;
  /** 回复目标（多轮回复时传） */
  replyTo?: { commentId: string; name: string; content: string } | null;
}): Promise<MomentCommentView> {
  const { apiConfig, platform, peer, post, userName, replyTo } = args;
  // 回复目标解析（#41d）：必须是「真实存在于 post.comments 的用户评论」——悬空 replyTo 与
  // 非用户评论视同无 replyTo，照防自评拦截（作者不能借悬空 replyTo 给自己的动态写评论）。
  // 作者回复用户在自己动态下的评论仍是正常多轮互动，放行（用户评论 AI 动态 → AI 回）。
  const parentComment = replyTo
    ? (post.comments.find((c) => c.id === replyTo.commentId && c.author === 'user') ?? null)
    : null;
  if (!parentComment && isPostByPeer(post, peer)) throw new Error('发帖人不能评论自己的动态');
  // #14：纯图动态也要能评论——「动态内容」按需组装：有文字用原文（有配图时附张数标记）；
  // 文字与配图都空才跳过（无事可评）。#19：纯图动态不再往文案里塞「（该动态仅配图…」
  // 协议标记（前缀可被用户正文伪造、标记原文也会漏进 prompt）——payload 改带显式布尔
  // imagesOnly，route 按布尔注入防编造规则
  const postText = post.content.trim();
  // 「文字图片」卡片也是配图（AI 配图降级产物）：纯卡片动态同样要能被评论（防编造规则同纯图）
  const imagesOnly = !postText && (post.images.length > 0 || Boolean(post.textCard)) && !post.repostOf;
  // #18：转发动态的正文只是转发理由——评论素材用统一口径带上被转发的原文摘要（见 repostContextText）
  const postContent = post.repostOf
    ? repostContextText(
        post.repostOf,
        postText && post.images.length > 0 ? `${postText}（配图${post.images.length}张）` : postText,
        120
      )
    : postText
      ? post.images.length > 0
        ? `${postText}（配图${post.images.length}张）`
        : postText
      : imagesOnly
        ? `（该动态仅配图无文字，共${post.images.length}张图）`
        : '';
  if (!postContent) throw new Error('动态没有文字也没有配图，跳过评论');
  // feat-64：设置按平台独立（朋友圈/空间各一份）
  const settings = getMomentsSettings(platform);
  // 评论串（回复时带上下文，让 AI 接得住多轮）
  const thread = post.comments.slice(-6).map((c) => ({ authorName: c.authorName, content: c.content }));
  // 禁复读名单：TA 最近在两个平台说过的全部话（评论+转发理由）——
  // 同一条动态在微信和 QQ 里各生成一次评论时，后生成的一方读到了先落盘的那条，
  // 被明令禁止再说一样的话（修复「QQ 和微信的评论一字不差」）
  const avoid = recentSelfTextsOf(peer.id);
  // 回复自己动态下的评论时，把自己动态原文也列入禁复读——回复是接话，
  // 不能把动态改写一遍再说（用户实锤：「财啊，项目算搞定了，但下一个任务啥时候来啊」整句复读动态）
  if (parentComment && isPostByPeer(post, peer)) avoid.push(post.content.slice(0, 80));
  // 称呼规则（用户新要求）：不再由引擎按「评论区人数」一刀切（旧版：≥2人才允许叫名、单人回复强制剥名
  // → 所有角色都被迫用同一种称呼方式）。称呼完全交给 LLM：由角色人设、动态内容、评论内容/语气决定
  // 要不要称呼、怎么称呼；引擎只保留两条硬约束交给 prompt——①不要每句都叫；②要叫就叫真实名字（下方解析）。
  // #41d：回复对象必为「用户评论」（parentComment 已按 author==='user' 过滤），称呼用机主展示名由 route 端兜底
  // 生成后校验：与最近发言完全一致/高度雷同 → 带禁令重试一次；仍重复 → 抛错（队列按原策略处理）
  let banned = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // 称呼素材（用户实测：AI 回复评论自造「姐姐」称呼）：回复用户评论时把机主真实名字一并传给
    // 服务端——prompt 里「要叫就叫真实名字」用真名兜底，展示名（如昵称「财」）只是评论区显示用。
    // 解析失败（多账号/无档案）回退空串，服务端按展示名处理，行为与旧版一致。
    const userRealName = parentComment ? (await ownerRealNameFor(platformApp(platform)).catch(() => '')) || '' : '';
    const { content, contentZh } = await callGenerateApi(apiConfig, {
      kind: parentComment ? 'reply' : 'comment',
      platform,
      userName,
      peer: personaOf(peer),
      // #14/#19：纯图动态传显式布尔 imagesOnly（route 按布尔注入防编造）；文字动态传原文（有配图附张数标记）；
      // #18：转发动态 content 为统一口径（转发@原作者：原文摘要｜理由：转发理由）
      post: { authorName: post.authorName, author: post.author, content: postContent.slice(0, 200), imagesOnly },
      thread,
      // #41d：只把「真实存在的用户评论」作为回复目标传给服务端（parentAuthor 供服务端同口径校验）；
      // realName=机主真实名字：称呼红线（禁自造「姐姐/哥哥」类称谓）用真名兜底
      replyTo: parentComment
        ? {
            authorName: parentComment.authorName,
            content: parentComment.content,
            realName: userRealName || undefined,
            parentAuthor: 'user' as const,
          }
        : null,
      memories: memorySnippets(peer.id, platformApp(platform)),
      avoid: attempt === 0 ? avoid : [...avoid, banned].filter(Boolean),
      variation: randomVariation(parentComment ? 'reply' : 'comment'),
      bilingual: settings.bilingualEnabled,
      bilingualPrompt: settings.bilingualPrompt || DEFAULT_BILINGUAL_PROMPT,
    });
    // 称呼不再由引擎剥离处理：称呼方式由角色人设决定（爱喊人的角色喊名字是TA的说话习惯，
    // 引擎一刀切剥名 = 所有角色同一种称呼，正是要避免的）；「不要每句都叫」由 prompt 硬约束。
    if (!isDupText(content, avoid)) {
      const added = await addCharMomentComment(platform, post.id, {
        peer,
        userName,
        content,
        contentZh: contentZh || undefined,
        replyTo: parentComment ? { commentId: parentComment.id, name: parentComment.authorName } : null,
      });
      if (!added) throw new Error('评论未写入（动态可能已删除或内容重复）');
      return added;
    }
    banned = content;
  }
  throw new Error('评论与最近发言重复，已阻止写入');
}

/**
 * AI 转发用户的动态到自己的空间（QQ 空间；带一句转发理由，生成走 /api/moments/generate kind='repost'）。
 * 转发是一条新动态（转发理由为正文 + repostOf 引用原动态摘要），原动态作者收到「转发」互动消息。
 * 只转发用户（机主）发的、且不是转发链的动态；同一角色不重复转发同一条。
 */
export async function aiRepostMoment(args: {
  apiConfig: ApiConfig;
  platform: MomentPlatform;
  peer: ContactRecord;
  post: MomentPostView;
  userName: string;
}): Promise<MomentPostView | null> {
  const { apiConfig, platform, peer, post, userName } = args;
  // 四轮审计 M2：peer 已不在册（删联系人后的迟到触发）→ 静默跳过（不算失败，不影响点赞/评论）
  if (!(await listContacts()).some((c) => c.id === peer.id)) return null;
  if (post.author !== 'user' || post.repostOf) return null; // 只转发用户的原创动态
  if (isPostByPeer(post, peer)) return null; // 不能转发自己的动态（防御）
  // 同一角色已转过同一条 → 不重复转发
  const already = listMomentPosts(platform, userName).some((x) => x.repostOf?.postId === post.id && x.peerId === peer.id);
  if (already) return null;
  const settings = getMomentsSettings(platform);
  // 禁复读：TA 最近说过的话（评论/转发理由，跨平台）——转发理由不与自己其他平台的话雷同
  const avoid = recentSelfTextsOf(peer.id);
  // #42：反自相矛盾素材——TA 最近发过的原创动态（转发理由不得与之重复/在事实与心情上矛盾，对照 aiPostMoment）
  const ownPosts = ownRecentPostsOf(peer.id);
  // #14：纯图动态也可被转发——组「原动态内容」：有文字用原文（有配图附张数标记），
  // 无文字但有配图为纯图动态（#19：payload 显式布尔 imagesOnly，不再靠文案前缀传标记）；
  // 两者都空则无从转发（静默跳过，不算失败）
  const postText = post.content.trim();
  const imagesOnly = !postText && post.images.length > 0;
  const postContent = postText
    ? post.images.length > 0
      ? `${postText}（配图${post.images.length}张）`
      : postText
    : imagesOnly
      ? `（该动态仅配图无文字，共${post.images.length}张图）`
      : '';
  if (!postContent) return null;
  const { content, contentZh } = await callGenerateApi(apiConfig, {
    kind: 'repost',
    platform,
    userName,
    peer: personaOf(peer),
    post: { authorName: post.authorName, author: post.author, content: postContent.slice(0, 120), imagesOnly },
    memories: memorySnippets(peer.id, platformApp(platform), 4),
    ownRecentPosts: ownPosts.map((p) => p.label),
    avoid,
    variation: randomVariation('comment'),
    bilingual: settings.bilingualEnabled,
    bilingualPrompt: settings.bilingualPrompt || DEFAULT_BILINGUAL_PROMPT,
  });
  if (isDupText(content, avoid)) {
    // 转发是锦上添花：理由与最近发言雷同 → 直接放弃本次转发（不影响点赞/评论）
    return null;
  }
  const created = addCharMomentPost(platform, {
    peer,
    userName,
    content,
    contentZh: contentZh || undefined,
    repostOf: {
      postId: post.id,
      author: post.author,
      authorName: post.authorName,
      content: post.content.slice(0, 80),
      images: post.images.slice(0, 3),
    },
  });
  // #41a：转发也是「TA 发了一条新动态」→ 其他 NPC 好友延迟来点赞/评论（对照 aiPostMoment；
  // 此前转发落盘后直接 return，转发动态永远没有后续互动）
  enqueuePostInteractions(platform, created.id, settings.npcInteractDelay);
  return created;
}

// ---------------- 调度结算（MomentsScheduler 每 5s 调一次） ----------------

export interface MomentTickDeps {
  apiConfig: ApiConfig;
  /** 全部联系人（真实名字；调度器异步加载传入） */
  contacts: ContactRecord[];
  /** 机主展示名（wx/qq 平台各一个；空串跳过对应平台） */
  wxUserName: string;
  qqUserName: string;
}

let ticking = false;

/** #20：单次 tick 的总时间预算——tick 全程持跨标签页互斥锁（withTickMutex）且 drain 的
 *  多次 LLM 往返串行，无预算最坏可把锁占住数分钟。超预算即停止开新的 LLM 往返
 *  （不中断在途请求、不影响单条请求内部重试），剩余到期项顺延一个轮询周期，下个 tick 续做 */
const TICK_TIME_BUDGET_MS = 90_000;
/** 调度轮询周期（MomentsScheduler TICK_MS = 5s）：#20 超预算顺延与 #5 拉黑顺延共用这一步长 */
const TICK_POLL_INTERVAL_MS = 5_000;

function lastCharPostAt(platform: MomentPlatform, userName: string, peer: ContactRecord): number {
  const hit = listMomentPosts(platform, userName)
    .filter((p) => isPostByPeer(p, peer))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return hit?.createdAt ?? 0;
}

/** 平台好友全集（char/npc 且为该平台好友，不过滤拉黑）：drainInteractions 需要区分
 *  「真没候选」与「拉黑导致候选为空」（#5），先拿全集再分步过滤 */
function contactsForPlatform(contacts: ContactRecord[], platform: MomentPlatform): ContactRecord[] {
  return contacts.filter((c) => (c.kind === 'char' || c.kind === 'npc') && isFriendIn(c, platform));
}

function peersForPlatform(contacts: ContactRecord[], platform: MomentPlatform): ContactRecord[] {
  // 拉黑过滤：被拉黑（双向）的角色不进候选——runAutoPosts（自动发帖）枚举用；
  // drainInteractions（互动结算）需区分两种空态（#5），改为从 contactsForPlatform 自行分步过滤
  return contactsForPlatform(contacts, platform).filter((c) => !isPeerBlocked(platform, c.id));
}

/** 结算到期的 AI 回复（用户评论/回复了 AI → AI 再回复）；未到期/未处理的项原样保留。
 *  #20：overBudget 为 true 时不再开新的 LLM 往返，剩余到期项顺延一个轮询周期（下个 tick 续做） */
async function drainReplies(
  queue: MomentQueueItem[],
  now: number,
  deps: MomentTickDeps,
  overBudget: () => boolean
): Promise<MomentQueueItem[]> {
  const keep: MomentQueueItem[] = [];
  // 四轮审计 M2：drain 前读一次新鲜联系人——调度器（MomentsScheduler）每 60s 才刷新 deps.contacts，
  // 删联系人后 ≤60s 窗口内 stale 数组会把已删联系人当回复对象；peer 不在 fresh 列表直接丢弃
  //（读取失败退回 deps.contacts，保持旧行为）
  const freshContacts = await listContacts().catch(() => deps.contacts);
  for (const item of queue) {
    if (item.type !== 'reply') {
      keep.push(item); // 互动项透传给下一步
      continue;
    }
    if (item.fireAt > now) {
      keep.push(item);
      continue;
    }
    try {
      const peer = freshContacts.find((c) => c.id === item.peerId);
      // 传 contacts：legacy 数据的角色动态也能解析出 peerId（记忆归属/身份守卫都依赖它）
      const post = listMomentPosts(item.platform, item.userName, freshContacts).find((p) => p.id === item.postId);
      const parent = post?.comments.find((c) => c.id === item.parentCommentId);
      if (!peer || !post || !parent) continue; // 动态/评论已被删（或 peer 已删除）→ 丢弃
      // 防串台（一.1）：AI 只回「用户发的评论」。旧版本遗留的队列项指向 AI 自己/别人的评论
      // （会生成「乐乐 回复 乐乐」这种错误指向），直接丢弃不生成
      if (parent.author !== 'user') continue;
      // 该角色已经回复过这条评论（重试/遗留重复）→ 不再生成
      if (post.comments.some((c) => c.peerId === item.peerId && c.parentId === parent.id)) continue;
      // 四轮审计 L1：上面的死项清理判定（动态/评论缺失、非用户评论、已回复）必须先于 #5 拉黑顺延——
      // 旧顺序拉黑检查在前，拉黑期间的死项从「丢弃」变「每次 +5s 顺延常驻」占队列容量；
      // 现在死项直接丢弃，只有「活项但被拉黑」才顺延
      // #5：拉黑期间（双向）不结算也不丢弃——顺延一个轮询周期，解除后下个 tick 自然恢复
      //（与 isPeerBlocked 文档「解除后互动自然恢复」对齐；旧版 continue 整丢，拉黑解除后回复永远不来）
      if (isPeerBlocked(item.platform, item.peerId)) {
        keep.push({ ...item, fireAt: now + TICK_POLL_INTERVAL_MS });
        continue;
      }
      // #20：超时间预算 → 停止本轮结算：不再开新的 LLM 往返，本项顺延一个轮询周期（不计失败次数）
      if (overBudget()) {
        keep.push({ ...item, fireAt: now + TICK_POLL_INTERVAL_MS });
        continue;
      }
      await aiCommentOnMoment({
        apiConfig: deps.apiConfig,
        platform: item.platform,
        peer,
        post,
        userName: item.userName,
        replyTo: { commentId: parent.id, name: parent.authorName, content: parent.content },
      });
      emitMomentsChanged(item.platform);
    } catch (err) {
      // 失败重试：最多 3 次，每次顺延 90s
      console.warn('[moments] reply 生成失败（将重试）', err);
      if (item.tries < 2) keep.push({ ...item, tries: item.tries + 1, fireAt: now + 90_000 });
    }
  }
  return keep;
}

/** 结算到期的用户动态互动（1-2 位平台好友点赞 + 可能评论）。
 *  结算失败（生成抛错 / 选了候选却零互动产生）不丢弃该项，而是顺延 60~90 秒重试，
 *  最多重试 2 次（第三次失败才丢弃）——修复「首战全失败该动态永远没有 AI 互动」。
 *  #20：overBudget 为 true 时不再开新的 LLM 往返，剩余到期项顺延一个轮询周期（下个 tick 续做） */
async function drainInteractions(
  queue: MomentQueueItem[],
  now: number,
  deps: MomentTickDeps,
  overBudget: () => boolean
): Promise<MomentQueueItem[]> {
  const keep: MomentQueueItem[] = [];
  const retryDelayMs = () => 60_000 + Math.floor(Math.random() * 30_000); // 60~90 秒随机
  // 四轮审计 M2：drain 前读一次新鲜联系人（覆盖 drainReplies 期间的删除）——互动候选一律基于
  // fresh 列表过滤，已删联系人不再作为点赞/评论/转发候选（落库层 addCharMomentComment/Like 另有复核兜底）
  const freshContacts = await listContacts().catch(() => deps.contacts);
  for (const item of queue) {
    if (item.type !== 'interact') {
      keep.push(item);
      continue;
    }
    if (item.fireAt > now) {
      keep.push(item);
      continue;
    }
    const retryLater = (): boolean => {
      // 保持现有去重逻辑不变（enqueuePostInteractions 仍按 postId 去重，重试项复用同一队列项）
      if ((item.attempts ?? 0) >= 2) return false;
      keep.push({ ...item, attempts: (item.attempts ?? 0) + 1, fireAt: now + retryDelayMs() });
      return true;
    };
    try {
      const userName = item.platform === 'wx' ? deps.wxUserName : deps.qqUserName;
      // 传 contacts：legacy 数据的角色动态也能解析出 peerId（发帖人排除/记忆归属都依赖它；M2：用 fresh 列表）
      const post = listMomentPosts(item.platform, userName, freshContacts).find((p) => p.id === item.postId);
      if (!post) continue; // 已删除
      const eligible = (p: ContactRecord): boolean =>
        // Task 38（1A）：出生静默期的分支角色不参与自动互动（不点赞/不评论/不转发）
        !isBranchBirthSilent(p.id) &&
        // 发帖人不能给自己的动态点赞/评论（防「AI 自己给自己评论」的核心修复）
        !(post.author === 'char' && isPostByPeer(post, p)) &&
        !post.likes.some((l) => isInteractionByPeer(l, p)) &&
        !post.comments.some((c) => isInteractionByPeer(c, p));
      // #5：候选分两步算——先按资格（不看拉黑）算「本可候选」，再过滤拉黑得「实际候选」：
      // 实际候选为空而本可候选非空 = 拉黑导致的空 → 顺延一个轮询周期（解除后自然恢复，不消耗重试次数）；
      // 本可候选也为空 = 好友都已互动过/无候选 → 正常结束（不算失败，不重试不无限顺延）
      const platformPeers = contactsForPlatform(freshContacts, item.platform);
      const candidates = platformPeers.filter((p) => !isPeerBlocked(item.platform, p.id) && eligible(p));
      if (candidates.length === 0) {
        if (platformPeers.some(eligible)) keep.push({ ...item, fireAt: now + TICK_POLL_INTERVAL_MS });
        continue;
      }
      // #20：超时间预算 → 停止本轮结算：不再开新的 LLM 往返，本项顺延一个轮询周期（不消耗重试次数）
      if (overBudget()) {
        keep.push({ ...item, fireAt: now + TICK_POLL_INTERVAL_MS });
        continue;
      }
      // 随机挑 1-2 位（动态像真人刷到一样陆续有互动）
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const pickedAll = shuffled.slice(0, Math.random() < 0.5 ? 1 : 2);
      // Task 38（3A）：同源互斥——同一分支链（rootId 相同）的角色一次结算只出场一位，
      // 防止本体+分支（同一个人设）前后脚给同一条动态发雷同评论/双点赞
      const seenRoots = new Set<string>();
      const picked = pickedAll.filter((p) => {
        const root = branchRootIdOf(p.id);
        if (seenRoots.has(root)) return false;
        seenRoots.add(root);
        return true;
      });
      // feat-64：点赞/评论概率按平台独立
      const settings = getMomentsSettings(item.platform);
      let produced = false; // 本轮是否实际产生了互动
      for (const peer of picked) {
        try {
          // 点赞：按 likeProbability 决定（旧版硬编码 100%）
          if (Math.random() < settings.likeProbability && (await addCharMomentLike(item.platform, post.id, { peer, userName }))) {
            produced = true;
          }
          // 评论：按 commentProbability 决定（旧版硬编码 70%）
          if (Math.random() < settings.commentProbability) {
            await aiCommentOnMoment({ apiConfig: deps.apiConfig, platform: item.platform, peer, post, userName });
            produced = true;
          }
          // QQ 空间转发（新）：好友刷到你的动态，可能转发到 TA 的空间（带一句转发理由）；
          // 只转用户的原创动态，转发会让原动态作者收到「空间消息·转发」通知。
          // #42：转发概率读本平台设置（0-100 百分比，缺省 22），不再硬编码 22%
          if (item.platform === 'qq' && post.author === 'user' && !post.repostOf && Math.random() < settings.repostProbability / 100) {
            try {
              if (await aiRepostMoment({ apiConfig: deps.apiConfig, platform: 'qq', peer, post, userName })) produced = true;
            } catch {
              // 转发失败不影响点赞/评论
            }
          }
        } catch (err) {
          // 单个角色失败不影响其他角色（是否重试由下方「整体零互动产生」判定统一兜住）
          console.warn('[moments] 单个角色互动失败', peer.name, err);
        }
      }
      if (produced) emitMomentsChanged(item.platform);
      // 零互动产生（生成抛错 / 概率未命中 / 单角色失败）→ 顺延重试，最多 2 次；
      // 候选为空在上面已正常结束，不会进到这里
      if (!produced) retryLater();
    } catch (err) {
      // 队列项整体失败（列表读取等异常）：同样顺延重试，最多 2 次（第三次失败才丢弃）
      console.warn('[moments] 互动队列项失败', item.postId, err);
      retryLater();
    }
  }
  return keep;
}

/** 到点检查自动发布（定时 / 频率 / 聊天灵感；一次 tick 最多发 1 条，防突发轰炸）
 *  feat-64：开关与节奏按平台独立 —— 朋友圈/空间各自的 autoPostEnabled 与 min/max 间隔互不影响 */
async function runAutoPosts(deps: MomentTickDeps, now: number): Promise<void> {
  // 账号级 429 冷却中：本轮 tick 直接跳过（配额让给前台翻译/生成）
  try {
    const until = kvGet<number>(GLOBAL_429_UNTIL_KEY) ?? 0;
    if (Date.now() < until) return;
  } catch {
    /* kv 异常不拦发帖 */
  }
  const plan: { peer: ContactRecord; platform: MomentPlatform; cfg: MomentAutoCfg; hint?: string }[] = [];
  for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
    const settings = getMomentsSettings(platform);
    if (!settings.autoPostEnabled) continue;
    const minMs = settings.minPostInterval * 60_000; // 分钟 → 毫秒
    const maxMs = settings.maxPostInterval * 60_000;
    const userName = platform === 'wx' ? deps.wxUserName : deps.qqUserName;
    if (!userName) continue;
    for (const peer of peersForPlatform(deps.contacts, platform)) {
      // Task 38（1A）：出生静默期的分支角色暂不自动发帖（创建后 24h 内、或用户尚未主动聊过天）
      if (isBranchBirthSilent(peer.id)) continue;
      const cfg = getMomentAutoCfg(peer.id, platform);
      if (!cfg.enabled) continue;
      const last = lastCharPostAt(platform, userName, peer);
      const sinceLast = now - last;
      // 最小间隔：距离上次发帖不足 minPostInterval 则跳过（首次发帖 last=0 不受限）
      if (last > 0 && sinceLast < minMs) continue;
      if (cfg.trigger === 'schedule') {
        // 定时：今天 HH:mm 已到且那之后没发过 → 到点（App 当时没开也补发）
        const due = new Date(now);
        due.setHours(cfg.hh, cfg.mm, 0, 0);
        if (now >= due.getTime() && last < due.getTime()) {
          plan.push({ peer, platform, cfg });
        } else if (sinceLast >= maxMs) {
          // 最大间隔兜底：超过 maxPostInterval 强制触发（schedule 模式无显式间隔）
          plan.push({ peer, platform, cfg });
        }
      } else if (cfg.trigger === 'interval') {
        if (now - last >= cfg.intervalHours * 3_600_000) plan.push({ peer, platform, cfg });
      } else {
        // 聊天灵感（有感而发）：不攒轮次、不设时间门槛——AI 心血来潮想发就发。
        // 实现为每次 tick 小概率触发（期望约 6 分钟一次，配合全局最短间隔形成自然节奏）；
        // 下面的 15 分钟最小间隔只是防连发刷屏的保险，不是触发条件
        if (sinceLast >= maxMs) {
          // 最大间隔兜底：超过 maxPostInterval 强制触发（chat 模式无显式间隔）
          plan.push({ peer, platform, cfg, hint: '结合你们最近聊过的话题和你的近况，有感而发' });
        } else if (now - last >= 15 * 60_000 && Math.random() < 1 / 80) {
          plan.push({ peer, platform, cfg, hint: '结合你们最近聊过的话题和你的近况，有感而发' });
        }
      }
    }
  }
  if (plan.length === 0) return;
  // C5：挑人前先剔除处于 10 分钟退避期的候选——此前「挑中后才查退避并 return」，
  // 一个退避中的角色会压住本次 tick，其他已到期的角色这一 tick 也不发（被饿到下一轮）
  const notBackoff = plan.filter((p) => {
    try {
      const lastTry = kvGet<number>(attemptKey(p.peer.id, p.platform)) ?? 0;
      return now - lastTry >= 10 * 60_000;
    } catch {
      return true;
    }
  });
  const pool = notBackoff.length > 0 ? notBackoff : plan; // 全在退避时保持旧行为（等退避结束）
  // 一次只发一条（其余下个 tick 再发）；失败退避 10 分钟
  const pick = pool[Math.floor(Math.random() * pool.length)];
  // 四轮审计 M2：发帖前复核 pick.peer 仍在新鲜联系人列表（plan 基于调度器 stale 快照构建）——
  // 已删除则直接跳过（不写退避标记、无副作用；aiPostMoment 入口另有复核兜底）
  if (!(await listContacts().catch(() => [] as ContactRecord[])).some((c) => c.id === pick.peer.id)) return;
  const aKey = attemptKey(pick.peer.id, pick.platform);
  try {
    const lastTry = kvGet<number>(aKey) ?? 0;
    if (now - lastTry < 10 * 60_000) return;
  } catch {
    // 忽略
  }
  const userName = pick.platform === 'wx' ? deps.wxUserName : deps.qqUserName;
  try {
    kvSet(aKey, now);
    await aiPostMoment({
      apiConfig: deps.apiConfig,
      platform: pick.platform,
      peer: pick.peer,
      userName,
      hint: pick.hint,
    });
    emitMomentsChanged(pick.platform);
  } catch (err) {
    // 保留退避标记（10 分钟后重试）
    const errMsg = err instanceof Error ? err.message : String(err);
    // 429/限流是账号级的：写全局冷却 5 分钟，之后所有角色暂停自动发帖，
    // 把 SDK 配额让给前台（论坛翻译一直失败的主要根源就是这里排队撞 429）
    if (/429|too many requests|rate.?limit/i.test(errMsg)) {
      try {
        kvSet(GLOBAL_429_UNTIL_KEY, Date.now() + GLOBAL_429_COOLDOWN_MS);
      } catch {
        /* kv 异常忽略 */
      }
    }
    console.warn('[moments] 自动发帖失败', pick.peer.name, pick.platform, err);
  }
}

/** 跨标签页互斥（#43）：锁名与 kv 租约键（多标签页同时开着手机时，同一 tick 只允许一个标签页执行，
 *  防队列/动态数据被两边同时结算双跑） */
const TICK_LOCK_NAME = 'moments-tick';
const TICK_LEASE_KEY = 'moments-tick-lease';
const TICK_LEASE_MS = 15_000;

/** Web Locks 最小形状（按结构收窄，不依赖具体 lib.dom 版本的 LockManager 类型） */
interface LockManagerLike {
  request?: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<unknown>;
}

/** 跨标签页互斥执行：优先 Web Locks（拿不到锁 = 另一标签页正在跑，直接跳过本 tick）；
 *  不支持 Web Locks 的环境回退 kv 租约（执行前检查 15s 内有租约则跳过，开始时占住，finally 释放）。 */
async function withTickMutex(fn: () => Promise<void>): Promise<void> {
  const locks: LockManagerLike | undefined =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  if (locks && typeof locks.request === 'function') {
    await locks.request(TICK_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return; // 另一标签页持锁 → 本 tick 跳过
      await fn();
    });
    return;
  }
  // 回退：kv 租约（尽力而为；同一进程内 memStore 同步可见，跨进程以 IndexedDB 为准）
  try {
    const held = kvGet<number>(TICK_LEASE_KEY);
    if (typeof held === 'number' && Date.now() - held < TICK_LEASE_MS) return;
    kvSet(TICK_LEASE_KEY, Date.now());
    await fn();
  } finally {
    try {
      kvDel(TICK_LEASE_KEY);
    } catch {
      // 忽略
    }
  }
}

/**
 * 调度 tick（全局唯一入口，MomentsScheduler 每 5s 调用）：
 * 1) 结算到期的 AI 回复（多轮互动）；2) 结算用户动态的 AI 互动；3) 检查自动发布三种触发。
 * 防重入：同标签页 ticking 标志 + 跨标签页互斥（#43）；任何失败不外抛（动态是增强能力）。
 * #20：tick 有总时间预算（TICK_TIME_BUDGET_MS），超预算停止本轮结算，剩余到期项顺延下个 tick 续做。
 */
export async function runMomentsTick(deps: MomentTickDeps): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await withTickMutex(async () => {
      const now = Date.now();
      const startedAt = now;
      const overBudget = (): boolean => Date.now() - startedAt > TICK_TIME_BUDGET_MS;
      const queue = loadQueueSafe();
      const afterReplies = await drainReplies(queue, now, deps, overBudget);
      const remaining = await drainInteractions(afterReplies, now, deps, overBudget);
      // #1：落盘前重读存储最新队列做合并——drain 期间（多次 LLM 往返）enqueuePostInteractions /
      // enqueueCharReply 会直接读-改-写存储入队（AI 转发的 NPC 互动、用户新发动态的互动等），
      // 旧版直接 saveQueue(remaining) 会用陈旧快照把这些 drain 期间入队的新项覆盖吞掉。
      // 合并规则（按队列项唯一 id）：
      // - remaining 中的项以 remaining 为准（tick 已结算/已顺延的状态）；
      //   其中 drain 期间被删动态/删评论/删联系人连带从存储清掉的项（latest 已无）不复活；
      // - latest 中「快照里没有」的项 = drain 期间新入队 → 追加保留（enqueue 的 postId /
      //   parentCommentId 去重以存储为准，不受本次合并影响）。
      // 存储读不到（键不存在/异常）时退回旧行为直接落 remaining。
      const latest = loadQueueOrNull();
      let merged: MomentQueueItem[];
      if (latest === null) {
        merged = remaining;
      } else {
        const latestIds = new Set(latest.map((x) => x.id));
        const snapshotIds = new Set(queue.map((x) => x.id));
        merged = [...remaining.filter((x) => latestIds.has(x.id)), ...latest.filter((x) => !snapshotIds.has(x.id))];
      }
      // 内容级判断是否落盘——重试顺延/retry 变异（fireAt/attempts/tries 变化）不改队列长度，
      // 旧版「长度变了才 saveQueue」把纯顺延的变异丢弃 → 退避失效、attempts 永不累计、无限重试。
      // 队列项都是普通对象且变异走同序 spread（不改键序），JSON 序列化对比即可精确判定「是否有任何变化」。
      if (JSON.stringify(merged) !== JSON.stringify(latest ?? queue)) saveQueue(merged);
      // #20：预算耗尽时跳过自动发布检查（下个 tick 自然续做；一次 tick 本就最多发 1 条）
      if (!overBudget()) await runAutoPosts(deps, now);
    });
  } catch {
    // 静默
  } finally {
    ticking = false;
  }
}

// ---------------- 聊天感知注入（四：私聊 system 带「最近动态 + 相关互动」） ----------------

function momentTimeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 组装「最近的社交动态」注入块（各聊天 App 的 system 消息追加）。
 * - 好友能看到彼此的动态：用户广播动态 + 该角色自己的动态 + 相关评论都会列出；
 * - 用户广播动态首次被「看到」时懒写入该角色记忆（三.1：用户发动态 → 写入该角色记忆；
 *   只写真正聊得起来的角色，避免把每条动态复制进所有联系人的记忆库）；
 * - 互通开关关闭时只注入当前 App 对应平台的动态（六.3：sms/phone 无自有平台 → 不注入）；
 * - 与记忆召回互相独立：没动态返回空串，注入块不存在也不影响原有 prompt。
 */
export function buildMomentsChatBlock(args: {
  contactId: string;
  app: MemApp;
  /** 机主展示名（动态作者匹配用；读操作不改写平台机主名） */
  userName: string;
  /** 机主真实名字（可选）：注入标签/归属说明用它指代用户——AI 视角统一真名（用户反馈：
   *  AI 一直用昵称呼叫用户），展示名只用于动态存储检索；缺省回退 userName */
  userRealName?: string;
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>;
}): string {
  const { contactId, app, userName, peer } = args;
  const userLabel = args.userRealName?.trim() || userName;
  if (!contactId || !peer?.id) return '';
  let allowed: MomentPlatform[] = [];
  try {
    const { share } = getMemSettings(contactId);
    allowed = share ? ['wx', 'qq'] : app === 'wx' ? ['wx'] : app === 'qq' ? ['qq'] : [];
  } catch {
    allowed = ['wx', 'qq'];
  }
  if (allowed.length === 0) return '';
  const posts: MomentPostView[] = [];
  // 本函数是同步读链路（各聊天 App 组装 system 用），拿不到异步的联系人名单——listMomentPosts 不传 contacts；
  // legacy 旧动态的归属判定由 isPostByPeer/isInteractionByPeer 内部的「展示名/真名」兜底匹配承担
  //（fix3-b：下方 roleTag/cTag 不再只认 peerId，旧动态不再被标成「别的AI角色」）
  for (const platform of allowed) {
    posts.push(...listMomentPosts(platform, userName));
  }
  // 取最近 6 条：该角色相关的（TA 的动态 / 有 TA 的互动）优先，再补用户最近的广播动态
  const relevant = posts.filter(
    (p) => isPostByPeer(p, peer) || p.likes.some((l) => isInteractionByPeer(l, peer)) || p.comments.some((c) => isInteractionByPeer(c, peer))
  );
  const relevantIds = new Set(relevant.map((p) => p.id));
  const rest = posts.filter((p) => !relevantIds.has(p.id) && p.author === 'user');
  const picked = [...relevant, ...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  if (picked.length === 0) return '';

  const appLabels = allowed.map((p) => MOMENT_APP_FULL_LABEL[p]).join('/');
  const lines: string[] = [
    `【最近的社交动态（${appLabels}；这些是动态广场内容，不是你们私聊的消息）】`,
  ];
  for (const p of picked) {
    const who = p.author === 'user' ? userLabel : p.authorName ?? '';
    // 归属标注铁律：每条动态必须一眼看出是谁发的——「AI角色本人，就是你自己」= 读到这段的 AI 自己，
    // 「用户本人」= 机主用户，其余 = 其他 AI 角色；杜绝 AI 把自己发的动态当成用户发的（反之亦然）。
    // fix3-b：判定统一走 isPostByPeer（peerId 优先，legacy 无 peerId 的旧数据按展示名/真名兜底命中）——
    // 旧版只认 p.peerId === peer.id，legacy 动态会被错标成「别的AI角色」
    const roleTag = p.author === 'user' ? '用户本人' : isPostByPeer(p, peer) ? 'AI角色本人，就是你自己' : 'AI角色';
    // #18：转发动态（QQ 手动转发为主路径）的正文只是转发理由——主行用统一口径带上被转发的原文摘要
    const lineText = p.repostOf ? repostContextText(p.repostOf, p.content, 60) : p.content.slice(0, 60);
    lines.push(
      `- ${momentTimeLabel(p.createdAt)} ${who}（${roleTag}）在${MOMENT_APP_FULL_LABEL[p.platform]}发了动态：「${lineText}」`
    );
    // 相关互动：该角色的点赞 + 最近的评论（最多 3 条，多轮回复按顺序）
    if (p.likes.some((l) => isInteractionByPeer(l, peer))) lines.push('  （你赞过这条动态）');
    for (const c of p.comments.slice(-3)) {
      const cWho = c.author === 'user' ? userLabel : c.authorName;
      // fix3-b：AI 评论同样用 isInteractionByPeer 判定是否「本人」（peerId 优先、名字兜底）
      const cTag = c.author === 'user' ? '用户本人' : isInteractionByPeer(c, peer) ? 'AI角色本人，就是你自己' : 'AI角色';
      const arrow = c.replyToName ? ` 回复 ${c.replyToName}` : '';
      lines.push(`  （评论：${cWho}（${cTag}）${arrow}：「${c.content.slice(0, 50)}」）`);
    }
  }
  lines.push(
    `（这些是你们在${appLabels}里的公开动态与互动，聊天时可以像真人一样自然提起（关心、调侃、接着聊都行），但不要把它们当成私聊内容，也不要生硬复述。` +
      `归属标注必须看清：标了「AI角色本人，就是你自己」的动态是你自己发的，标了「用户本人」的是${userLabel}发的——绝不能把自己发的动态说成${userLabel}发的，也不能把${userLabel}发的说成自己发的。）`
  );
  lines.push(
    `【动态提及频率硬规则】同一条动态最多主动提一次；对方已经回应看过（如「看了」「看到了」）或你们已经聊过这条动态之后，严禁再提「我给你发了朋友圈」「快去看看」「去看了吗」这类催促——重复催看非常败好感。对方没接这个话头就自然聊别的；没有新动态时绝不要翻旧账提动态。`
  );

  // 懒写入记忆：这次「被看到」的用户广播动态写进该角色记忆（去重：已入过库的动态跳过）。
  // 句式/detail（含转发上下文）/extra（本人互动从句，带「AI角色本人」标注）全部走单一事实源
  // expectedMomentMemoryOf（与 repair 同一函数，杜绝口径漂移）
  for (const p of picked) {
    if (p.author !== 'user') continue;
    if (memHasMomentFragment(contactId, p.id)) continue;
    writeMomentMemory({
      kind: 'post',
      post: p,
      comment: null,
      contact: { id: contactId, name: peer.name, nickname: peer.nickname },
      userName: userLabel,
    });
  }

  return lines.join('\n');
}

// ---------------- 旧版本遗留数据修复（MomentsScheduler 启动时执行一次） ----------------

/** 原始存储里是否存在「AI 回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char） */
function hasLegacySelfReplyRaw(platform: MomentPlatform): boolean {
  try {
    if (platform === 'wx') {
      const raw = kvGet<WxRawPost[]>(WX_MOMENTS_KEY);
      if (!Array.isArray(raw)) return false;
      return raw.some(
        (p) =>
          Array.isArray(p?.comments) &&
          p.comments.some(
            (c) =>
              Boolean(c) &&
              typeof c === 'object' &&
              (c as WxRawComment).authorKind === 'char' &&
              typeof (c as WxRawComment).author === 'string' &&
              (c as WxRawComment).replyTo === (c as WxRawComment).author
          )
      );
    }
    const raw = kvGet<Record<string, QqRawComment[]>>(QQ_COMMENTS_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return Object.values(raw).some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some(
          (c) =>
            Boolean(c) &&
            typeof c === 'object' &&
            (c as QqRawComment).authorKind === 'char' &&
            typeof (c as QqRawComment).author === 'string' &&
            (c as QqRawComment).replyTo === (c as QqRawComment).author
        )
    );
  } catch {
    return false;
  }
}

/**
 * 一次性修复旧版本遗留数据：AI「回复自己」的错误指向（listMomentPosts 视图层已兼容修复，
 * 这里再把修复结果写回存储，让 App 内的原始读取也能显示正确）。
 * fix3-b：回写时传入联系人名单——legacy 角色动态/评论的 peerId 借助名字匹配一次性补齐落盘
 * （后续 isPostByPeer/isInteractionByPeer 走 peerId 精确命中，roleTag 也不再错标「别的AI角色」）。
 * 保持同步签名（MomentsScheduler / QQ 动态页挂载即调、不 await），内部异步取联系人后执行。
 */
export function repairLegacyMomentData(): void {
  void (async () => {
    try {
      const contacts = await listContacts();
      for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
        if (!hasLegacySelfReplyRaw(platform)) continue;
        persistMomentPosts(platform, listMomentPosts(platform, undefined, contacts));
      }
    } catch {
      // 忽略（修复失败不影响功能，视图层读取时仍会兜底修复）
    }
  })();
}

// ---------------- 存量头像快照瘦身（引用式架构的收尾：身份存 peerId，头像渲染时实时解析） ----------------

/**
 * 存量头像快照瘦身（启动时执行一次，幂等）：
 * 历史动态/互动消息里存的头像快照（写入当时的 data URL，单张可达 400KB）只在
 * 「联系人已删除、实时解析不到」时才有展示价值——联系人还在的，渲染端 liveAvatarOf
 * 永远显示当前头像，快照是纯冗余。本遍历把「能解析到在册联系人」的快照清成 null：
 * - 归属判定与渲染端同一口径（contactByRef：peerId 精确命中优先，legacy 名字兜底）；
 * - 机主本人的动态（author==='user'）不清理——机主不是联系人，快照就是渲染源；
 * - 官方/系统互动消息不清理；
 * - 新写入的角色动态/互动消息一律不再存头像（写入点已改为 null），存量随本遍历逐步收敛。
 * 替代旧的「换头像事件驱动批量改写快照」同步器：不再需要任何数据面同步，换头像只写联系人一处。
 */
export async function stripMomentAvatarSnapshots(): Promise<void> {
  try {
    const contacts = await listContacts();
    if (contacts.length === 0) return;
    let changed = false;
    for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
      const list = listMomentPosts(platform, undefined, contacts);
      let postsChanged = false;
      const nextPosts = list.map((p) => {
        if (p.author !== 'char' || !p.avatar) return p;
        if (!contactByRef({ peerId: p.peerId, name: p.authorName }, contacts)) return p;
        postsChanged = true;
        return { ...p, avatar: null };
      });
      if (postsChanged) {
        persistMomentPosts(platform, nextPosts);
        changed = true;
      }
      const notices = loadNoticesSafe(platform);
      if (Array.isArray(notices) && notices.length > 0) {
        let noticesChanged = false;
        const nextNotices = notices.map((n) => {
          if (n.kind === 'official' || n.kind === 'system') return n;
          if (n.actorKind !== 'char' || !n.actorAvatar) return n;
          if (!contactByRef({ peerId: n.actorPeerId, name: n.actorName }, contacts)) return n;
          noticesChanged = true;
          return { ...n, actorAvatar: null };
        });
        if (noticesChanged) {
          saveNotices(platform, nextNotices);
          changed = true;
        }
      }
    }
    if (changed) emitMomentsChanged();
  } catch {
    // 瘦身是增强能力，失败静默（渲染端实时解析不受影响）
  }
}

// ---------------- 身份关系修复（「AI 自己给自己评论」历史 bug 的数据清理 + 记忆纠错） ----------------

/**
 * 清理历史 bug 数据：角色动态下「发帖人自己的评论/点赞」摘除（用户截图实锤的「L 评论 L 自己」）。
 * 判定：评论/点赞 author==='char' 且 peerId 与发帖人一致；legacy 无 peerId 时按名字一致兜底
 * （char 互动写入时 authorName 一律是 displayNameOf(actor)，与发帖人名相等即同一人）。
 * 摘除后级联清理这些评论在各角色记忆里的碎片；内部直接 persist 落盘。
 */
function stripSelfInteractionsFromPosts(platform: MomentPlatform, contacts: ContactRecord[]): MomentPostView[] {
  const posts = listMomentPosts(platform, undefined, contacts);
  let changed = false;
  const purgedCommentIds: { postId: string; commentId: string }[] = [];
  const next = posts.map((p) => {
    if (p.author !== 'char') return p;
    const isSelf = (x: { author: MomentAuthor; peerId: string | null; authorName?: string; name?: string }) =>
      x.author === 'char' &&
      ((x.peerId && x.peerId === p.peerId) || (!x.peerId && (x.authorName ?? x.name ?? '') === p.authorName));
    // 自评论判定：发帖人本人的评论；但「回复用户评论」的作者回复是正常互动（用户评论 AI 动态 → AI 回），
    // 不能当历史自评论 bug 摘掉（作者回复作者自己的评论仍算异常，照摘）
    const shouldStripComment = (c: MomentPostView['comments'][number]): boolean => {
      if (!isSelf(c)) return false;
      if (c.parentId) {
        const parent = p.comments.find((pc) => pc.id === c.parentId);
        if (parent && parent.author === 'user') return false;
      }
      return true;
    };
    const selfComments = p.comments.filter(shouldStripComment);
    const selfLikes = p.likes.filter((l) => isSelf(l));
    if (selfComments.length === 0 && selfLikes.length === 0) return p;
    changed = true;
    for (const c of selfComments) purgedCommentIds.push({ postId: p.id, commentId: c.id });
    return {
      ...p,
      comments: p.comments.filter((c) => !shouldStripComment(c)),
      likes: p.likes.filter((l) => !isSelf(l)),
    };
  });
  if (changed) {
    persistMomentPosts(platform, next);
    // 级联清理被摘除评论的记忆碎片（异步 fire-and-forget）
    for (const hit of purgedCommentIds) purgeMomentMemories(hit);
  }
  return next;
}

/**
 * 修正已写错关系的「动态来源」记忆碎片（用户实锤：乐乐发+乐乐评，记忆写成「乐乐评论了凡凡的动态」）。
 * 逐条按 sourcePostId/sourceCommentId 回溯原始动态与评论，按数据真实形态分流（fix3-b）：
 * - 句式重算统一走 expectedMomentMemoryOf 单一事实源（与写入侧同一函数，杜绝口径漂移），
 *   并补齐「于时间」标注与转发上下文（旧版重算不带时间，导致新格式碎片被反向降级）；
 * - 重算结果与已存不一致 → 改写（不删）；
 * - 校验失败/关系建立不了（expected 为 null）→ 保留不删（宁留勿删）——尤其用户广播动态的碎片
 *   （主人=任意看到它的 char）与「用户回复角色评论」的碎片（主人=被回复的角色）不再被误删；
 * - 既有删除路径保持不变且不新增：点赞/评论实体已不存在（点赞被取消、评论被删、历史自互动被清理）、
 *   角色动态/角色评论归属对不上（碎片主人不是发帖人/评论人本人）、角色动态发帖人无法定位；
 * - 动态查不到（超出 200 条滚动窗口被淘汰等）→ 保留不动（避免误删仍然真实的历史记忆）。
 * 幂等，可重复执行；由 MomentsScheduler 启动时触发一次。
 */
export async function repairMomentIdentityData(): Promise<void> {
  try {
    const contacts = await listContacts();
    if (contacts.length === 0) return;
    // 1) 先清数据层的历史自评论/自点赞（评论没了 → 下一步对应的错误记忆碎片会被删除）
    stripSelfInteractionsFromPosts('wx', contacts);
    stripSelfInteractionsFromPosts('qq', contacts);
    // 2) 记忆碎片逐条纠错
    // 多账号 v2：修复器横跨 wx/qq 两平台逐联系人重算，无单一 App 上下文，且只重写既有碎片文本
    // （不新建账号视角的记忆）→ 维持恒机主真名口径 ownerRealName()，不按账号切换
    const ownerReal = await ownerRealName();
    const realNameOf = new Map(contacts.map((c) => [c.id, c.name?.trim() || '']));
    const postsByPlatform: Record<MomentPlatform, MomentPostView[]> = {
      wx: listMomentPosts('wx', undefined, contacts),
      qq: listMomentPosts('qq', undefined, contacts),
    };
    const findPost = (postId: string): MomentPostView | undefined =>
      postsByPlatform.wx.find((p) => p.id === postId) ?? postsByPlatform.qq.find((p) => p.id === postId);
    for (const contact of contacts) {
      if (contact.kind === 'user') continue; // 记忆库都挂在角色（char/npc）名下
      const frags = listFragments(contact.id).filter((f) => f.source === 'moments');
      if (frags.length === 0) continue;
      const rewrites: { id: string; content: string }[] = [];
      const deletes: string[] = [];
      // 单一事实源句式重算用的真名解析（与 listFragments 同批联系人）
      const realNameOfId = (id: string) => realNameOf.get(id) || '';
      for (const f of frags) {
        const post = f.sourcePostId ? findPost(f.sourcePostId) : undefined;
        if (!post) continue; // 动态查不到 → 保留（可能是滚动窗口淘汰的老记忆，文本本身仍真实）
        // 句式重算统一走 expectedMomentMemoryOf 单一事实源（与写入侧同一函数，杜绝口径漂移）；
        // 删除仅限「既有删除路径」：实体已不存在 / 主人与数据真实形态对不上，绝不新增删除——
        // 用户广播动态（主人=任意看到它的角色）与「用户回复角色评论」（主人=被回复的角色）不再被误删
        if (f.sourceKind === 'post') {
          // 「TA 发了一条动态」：角色动态主人必须是发帖人（对不上才删）；用户广播动态主人=任意角色，合法
          if (post.author === 'char' && !isPostByPeer(post, contact)) {
            deletes.push(f.id); // 归属错误（记忆说 TA 发的，其实不是）→ 删
            continue;
          }
          const expected = expectedMomentMemoryOf('post', post, null, contact, ownerReal, realNameOfId);
          if (expected && expected !== f.content) rewrites.push({ id: f.id, content: expected });
          continue;
        }
        if (f.sourceKind === 'like') {
          const userLike = post.likes.find((l) => l.author === 'user');
          if (!(userLike && isPostByPeer(post, contact))) {
            const like = post.likes.find((l) => isInteractionByPeer(l, contact));
            if (!like) {
              deletes.push(f.id); // 点赞已不存在（含历史自赞被清理）→ 删
              continue;
            }
            if (post.author === 'char' && !post.peerId) {
              deletes.push(f.id); // 角色动态但发帖人无法定位 → 关系建立不了 → 删（宁缺勿错）
              continue;
            }
          }
          const expected = expectedMomentMemoryOf('like', post, null, contact, ownerReal, realNameOfId);
          if (expected && expected !== f.content) rewrites.push({ id: f.id, content: expected });
          continue;
        }
        // kind === 'comment'
        const comment = post.comments.find((c) => c.id === f.sourceCommentId);
        if (!comment) {
          deletes.push(f.id); // 评论已不存在（含历史自评论被清理/用户手动删除）→ 删
          continue;
        }
        if (comment.author === 'char') {
          // 角色评论：碎片主人必须是评论人本人
          if (!isInteractionByPeer(comment, contact)) {
            deletes.push(f.id); // 记忆库主人不是评论人 → 归属错误 → 删
            continue;
          }
          if (post.author === 'char' && !post.peerId) {
            deletes.push(f.id); // 角色动态但发帖人无法定位 → 删（宁缺勿错）
            continue;
          }
        } else {
          // 用户评论：顶层评论主人=动态作者；回复角色评论主人=被回复的角色；
          // 回复用户评论/悬空回复写入侧本就不产生记忆 → 旧垃圾照删（既有删除路径，不新增）
          if (comment.parentId) {
            const parent = post.comments.find((c) => c.id === comment.parentId) ?? null;
            if (!(parent && parent.author === 'char' && isInteractionByPeer(parent, contact))) {
              deletes.push(f.id); // 被回复的评论不是角色评论（或已不存在）→ 关系建立不了 → 删
              continue;
            }
          } else if (post.author !== 'char' || post.peerId !== contact.id) {
            deletes.push(f.id); // 碎片主人不是动态作者 → 归属错误 → 删
            continue;
          }
        }
        const expected = expectedMomentMemoryOf('comment', post, comment, contact, ownerReal, realNameOfId);
        if (expected && expected !== f.content) rewrites.push({ id: f.id, content: expected });
      }
      if (rewrites.length > 0) memRewriteMomentFragmentTexts(contact.id, rewrites);
      if (deletes.length > 0) memDeleteFragmentByIds(contact.id, deletes);
    }
  } catch {
    // 修复是增强能力，失败静默（视图层读取与写入侧守卫已兜底）
  }
}

// ---------------- 联系人删除级联清理（contacts-store.deleteContact 动态引入调用） ----------------

/** 删除该联系人的全部动态痕迹：TA 的动态、TA 的点赞/评论、队列里的待回复项与计数器、互动消息收件箱里的痕迹 */
export function purgeMomentsForContact(contactId: string): void {
  if (!contactId) return;
  try {
    for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
      const list = listMomentPosts(platform);
      const hadPost = list.some((p) => p.author === 'char' && p.peerId === contactId);
      const hadInteraction = list.some((p) => p.likes.some((l) => l.peerId === contactId) || p.comments.some((c) => c.peerId === contactId));
      if (!hadPost && !hadInteraction) continue;
      const next = list
        .map((p) => ({
          ...p,
          likes: p.likes.filter((l) => l.peerId !== contactId),
          comments: p.comments.filter((c) => c.peerId !== contactId),
        }))
        .filter((p) => !(p.author === 'char' && p.peerId === contactId));
      persistMomentPosts(platform, next);
      // 收件箱里 TA 发出的互动消息一并清掉（联系人已删，消息不该还在）
      const notices = loadNoticesSafe(platform);
      if (notices && notices.some((n) => n.actorPeerId === contactId)) {
        saveNotices(platform, notices.filter((n) => n.actorPeerId !== contactId));
      }
    }
    const q = loadQueueSafe().filter((x) => x.type !== 'reply' || x.peerId !== contactId);
    saveQueue(q);
    kvDel(attemptKey(contactId, 'wx'));
    kvDel(attemptKey(contactId, 'qq'));
  } catch {
    // 忽略
  }
}
