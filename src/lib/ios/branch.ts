/**
 * 角色分支（Task 37）：把一个角色联系人从某条消息（分支点）复制成一个全新的独立平行联系人。
 *
 * - 复制到分支点：人设/档案字段、聊天记录、三层记忆（碎片/核心/长期，按时间过滤 + 朋友圈引用重挂）、
 *   关系状态（relation/relationByAcc/relationToUser 记录字段）、微信朋友圈动态（副本重写归属与署名）、
 *   世界书挂载（专属书克隆成分支专属本）；
 * - 分支后两边完全独立：新联系人独立 ID，聊天/记忆/朋友圈/世界书/音色全部走新 ID 的键与字段，
 *   原角色读不到分支的新数据、分支也读不到原角色的新数据（键隔离天然保证，零管线改动）；
 * - 分支注册表（设备级键，不随账号作用域——分支关系属于联系人本体）：
 *   `char-branch-meta:<分支id>` 记录父/根/分支点；`char-branch-index` 记录 父id → 分支id[]；
 *   提示块构建器（buildBranchPromptBlock）据此给两侧注入「平行分支」认知，双方可在聊天里自然提到对方；
 * - 支持嵌套分支（分支可再分支，rootId 指向链头）；删除分支走 deleteContact 全量级联
 *   （聊天/记忆/朋友圈副本/挂载/相册/互动痕迹一次清干净）+ 注册表/克隆书清理，不影响原角色。
 *
 * 已知边界（如实说明）：
 * - 联系人 App 直接删除分支时不会清理注册表 → buildBranchPromptBlock 惰性自愈（死索引摘除）；
 * - 中间链分支被删后，其子分支的 parentId 悬空（提示块跳过缺失父辈，子分支照常独立运行）。
 */

import { kvDel, kvGet, kvGetRaw, kvSet, kvSetRaw } from '@/lib/ios/idb-kv';
import { getActiveAccountIdFor, MAIN_ACCOUNT_ID } from '@/lib/ios/accounts';
import { createContact, deleteContact, getContact, listContacts, setAppFriendFlag, getChatBgImage, setChatBgImage, getPeerBg, setPeerBg } from '@/lib/ios/contacts-store';
import {
  branchRootIdOf,
  childBranchIds,
  getBranchMeta,
  INDEX_KEY,
  META_PREFIX,
  type CharBranchMeta,
} from '@/lib/ios/branch-meta';
import { genId } from '@/lib/ios/db';
import { appendCopiedWxMomentPosts, getMomentAutoCfg, hasMomentAutoCfgEntry, listMomentPosts, saveMomentAutoCfg, type MomentPostView } from '@/lib/moments';
import { getBoundBookIds, loadBooks, saveBooks, setBoundBookIds, type WorldBook } from '@/lib/ios/worldbook';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import type { MemCore, MemFragment, MemLongTerm } from '@/lib/memory-core';
import { getReplyCount, hasReplyCount, saveReplyCount } from '@/lib/reply-count';
import { getTimeAware, setTimeAware } from '@/lib/time-aware';
import { getTranslateCfg, saveTranslateCfg } from '@/lib/chat-translate';
import { wxChatFlags } from '@/lib/chat-flags';

// 注册表实现拆到 branch-meta.ts（供朋友圈/来电/跨App找人引擎无环引用），这里 re-export 保持既有 import 路径
export { getBranchMeta, childBranchIds, branchRootIdOf, isBranchBirthSilent } from '@/lib/ios/branch-meta';
export type { CharBranchMeta } from '@/lib/ios/branch-meta';

/** 分支默认名：「原名·分支」（朋友圈/会话归属按 peerId + 署名，分支必须与原角色不同名防串） */
export function defaultBranchName(sourceName: string): string {
  const base = (sourceName || '').trim().slice(0, 26) || '角色';
  return `${base}·分支`;
}

// ---------------- 创建分支 ----------------

export interface CreateBranchOptions {
  /** 源角色联系人 id（char/npc；user 不可分支） */
  sourceId: string;
  /** 分支点消息 id（复制聊天记录到该条为止，含该条；同时决定记忆/朋友圈的时间过滤点） */
  pointMsgId: string;
  /** 分支名称（缺省「原名·分支」；与原角色同名时自动追加后缀） */
  name?: string;
}

export interface CreateBranchResult {
  contact: ContactRecord;
  meta: CharBranchMeta;
  /** 复制到分支聊天记录里的消息条数 */
  copiedMsgs: number;
}

/** 聊天消息的最小复制形状（wechat.tsx 的 WxMsg 不可反向 import，这里只触碰需要改写的字段） */
type BranchMsgLike = Record<string, unknown> & { id?: unknown; time?: unknown; content?: unknown; voice?: Record<string, unknown> | null };

/** 记忆键的账号后缀与 memory.ts scoped() 同源（wx App 当前账号；大号无后缀） */
function memSuffix(): string {
  try {
    const id = getActiveAccountIdFor('wx');
    return id === MAIN_ACCOUNT_ID ? '' : `--${id}`;
  } catch {
    return '';
  }
}

/** 分支创建时间的中文的日期标签（详情页/提示用） */
export function formatBranchDate(ts: number): string {
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

function branchDateLabel(ts: number): string {
  return formatBranchDate(ts);
}

/**
 * 创建分支角色。步骤：
 * 1. 校验源角色与分支点消息（从当前账号作用域的聊天记录里定位）；
 * 2. createContact 生成全新独立联系人（档案/人设/关系/头像/音色随记录字段复制，编号自动生成）；
 * 3. 当前账号置微信好友标记（出现在会话/通讯录列表）；
 * 4. 复制聊天记录到分支点（语音消息 contactId 重绑到分支 → 分支用自己的音色播放）；
 * 5. 复制三层记忆到分支点（createdAt/sourceTime 过滤 + 朋友圈来源碎片重挂到复制的动态副本）；
 * 6. 复制分支点之前的微信朋友圈动态（重写 id/归属/署名/互动人到分支）；
 * 7. 复制世界书挂载（专属书克隆成「（分支）」本，全局/局部书共享挂载）；
 * 8. 写注册表（meta + index）。
 * 任一副本步骤失败不阻断分支创建（catch 静默，主干联系人+聊天记录必成）。
 */
export async function createCharacterBranch(opts: CreateBranchOptions): Promise<CreateBranchResult> {
  const src = await getContact(opts.sourceId);
  if (!src) throw new Error('原角色不存在');
  if (src.kind === 'user') throw new Error('只能为角色联系人创建分支');

  // 1. 分支点消息（当前账号作用域；kv 层自动带账号后缀）
  const msgs = (kvGet<BranchMsgLike[]>(`wx-chat-msgs:${opts.sourceId}`) ?? []).filter((m) => m && typeof m === 'object');
  const idx = msgs.findIndex((m) => m.id === opts.pointMsgId);
  if (idx < 0) throw new Error('分支点消息不存在（可能已被删除），请重新长按选择');
  const point = msgs[idx];
  const pointTime = typeof point.time === 'number' && Number.isFinite(point.time) ? point.time : Date.now();
  const pointPreview = typeof point.content === 'string' ? point.content.slice(0, 80) : '';

  // 2. 新联系人（独立 ID；微信/QQ/手机号留空自动生成，避免与原角色重号）
  const srcDisplay = displayNameOf(src) || src.name;
  let name = (opts.name ?? '').trim().slice(0, 30) || defaultBranchName(srcDisplay);
  if (name === srcDisplay || name === src.name) name = defaultBranchName(srcDisplay);
  const contact = await createContact({
    kind: src.kind,
    ownerId: src.ownerId ?? null,
    name,
    gender: src.gender ?? null,
    age: src.age ?? null,
    height: src.height ?? null,
    weight: src.weight ?? null,
    persona: src.persona ?? null,
    background: src.background ?? null,
    occupation: src.occupation ?? null,
    company: src.company ?? null,
    region: src.region ?? null,
    birthday: src.birthday ?? null,
    relation: src.relation ?? null,
    relationToUser: src.relationToUser ?? null,
    relationByAcc: src.relationByAcc ?? null,
    avatar: src.avatar ?? null,
    avatars: src.avatars ?? null,
    voiceId: src.voiceId ?? null,
  });
  const newId = contact.id;
  const now = Date.now();

  // 3. 当前账号好友标记（会话/通讯录立即可见；其它账号可自行添加）
  try {
    await setAppFriendFlag('wx', newId, true);
  } catch {
    // 忽略
  }

  // 4. 聊天记录：到分支点为止（含）；语音消息 contactId 重绑 → 分支用自己的音色播历史语音。
  //    元素展开为新对象（kvGetRaw 返回内存活动引用，严禁原地改写污染源会话），嵌套 img/stk 等只读共享。
  const slice = msgs.slice(0, idx + 1).map((m) =>
    m.voice && typeof m.voice === 'object' ? { ...m, voice: { ...m.voice, contactId: newId } } : m,
  );
  try {
    kvSet(`wx-chat-msgs:${newId}`, slice);
  } catch {
    // 落盘失败不阻断（下次进入分支会话为空，不影响其它副本）
  }

  // 5-6. 朋友圈动态副本 + 记忆重挂映射（先建副本再复制记忆，碎片 sourcePostId/sourceCommentId 指到副本）
  const postIdMap = new Map<string, string>();
  const commentIdMap = new Map<string, string>();
  let wxViews: MomentPostView[] = [];
  try {
    const all = await listContacts();
    wxViews = listMomentPosts('wx', undefined, all);
    const srcPosts = wxViews.filter((p) => p.author === 'char' && p.peerId === opts.sourceId && p.createdAt <= pointTime);
    if (srcPosts.length > 0) {
      const copies: MomentPostView[] = srcPosts.map((p) => {
        const npid = genId();
        postIdMap.set(p.id, npid);
        return {
          ...p,
          id: npid,
          authorName: name,
          peerId: newId,
          likes: p.likes.map((l) => ({
            ...l,
            name: l.name === srcDisplay ? name : l.name,
            peerId: l.peerId === opts.sourceId ? newId : l.peerId,
          })),
          comments: p.comments.map((c) => {
            const ncid = genId();
            commentIdMap.set(c.id, ncid);
            return {
              ...c,
              id: ncid,
              authorName: c.authorName === srcDisplay ? name : c.authorName,
              peerId: c.peerId === opts.sourceId ? newId : c.peerId,
              replyToName: c.replyToName === srcDisplay ? name : c.replyToName,
            };
          }),
        };
      });
      appendCopiedWxMomentPosts(copies);
    }
  } catch {
    // 动态复制失败不阻断
  }

  // 7. 记忆三层：整体键拷贝（保留 consumedAt/supersededAt 等全部标记）+ 时间过滤 + 引用重挂。
  //    kvGetRaw 返回内存活动引用 → 先深拷贝再改写，杜绝污染源角色的记忆缓存。
  try {
    const sfx = memSuffix();
    const fragKey = (cid: string) => `mem-frag:${cid}${sfx}`;
    const coreKey = (cid: string) => `mem-ltm:${cid}${sfx}`;
    const longKey = (cid: string) => `mem-long:${cid}${sfx}`;

    const frags = JSON.parse(JSON.stringify(kvGetRaw<MemFragment[]>(fragKey(opts.sourceId)) ?? [])) as MemFragment[];
    const cores = JSON.parse(JSON.stringify(kvGetRaw<MemCore[]>(coreKey(opts.sourceId)) ?? [])) as MemCore[];
    const longs = JSON.parse(JSON.stringify(kvGetRaw<MemLongTerm[]>(longKey(opts.sourceId)) ?? [])) as MemLongTerm[];

    // 碎片：来源时间（提取时对话末条消息时间）≤ 分支点；核心/长期：入库时间 ≤ 分支点
    const keptFrags = frags.filter((f) => f && typeof f.id === 'string' && (f.sourceTime ?? f.createdAt) <= pointTime);
    const keptCores = cores.filter((c) => c && typeof c.id === 'string' && c.createdAt <= pointTime);
    const keptLongs = longs.filter((l) => l && typeof l.id === 'string' && l.createdAt <= pointTime);

    const fragIds = new Set<string>();
    const outFrags: MemFragment[] = [];
    for (const f of keptFrags) {
      if (f.source === 'moments' && f.sourcePostId) {
        const pid = postIdMap.get(f.sourcePostId);
        if (pid) {
          // 来源动态已复制 → 碎片重挂到副本（评论 id 同步重挂；评论不在复制集 → 丢弃）
          if (f.sourceCommentId) {
            const cm = commentIdMap.get(f.sourceCommentId);
            if (!cm) continue;
            f.sourceCommentId = cm;
          }
          f.sourcePostId = pid;
        } else {
          // 未复制的动态：机主广播的动态本体仍存在（「看到机主动态」记忆保留）；其余（QQ 来源动态、
          // 他人动态、对机主动态的点赞/评论互动）归属仍是原角色时间线 → 分支不带
          const p = wxViews.find((v) => v.id === f.sourcePostId);
          if (!(p && p.author === 'user' && f.sourceKind === 'post')) continue;
        }
      }
      fragIds.add(f.id);
      outFrags.push({ ...f, contactId: newId });
    }
    const allKeptIds = new Set<string>([...fragIds, ...keptCores.map((c) => c.id), ...keptLongs.map((l) => l.id)]);
    // supersede 修补：指向「分支点之后才出现的新条目」的已更新标记清掉（分支没学到那次更正，旧记忆在分支侧仍然成立）
    for (const f of outFrags) {
      if (f.supersededBy && !allKeptIds.has(f.supersededBy)) {
        f.supersededBy = undefined;
        f.supersededAt = undefined;
      }
    }
    const outCores = keptCores.map((c) => {
      const next = { ...c, contactId: newId };
      if (next.supersededBy && !allKeptIds.has(next.supersededBy)) {
        next.supersededBy = undefined;
        next.supersededAt = undefined;
      }
      return next;
    });
    const outLongs = keptLongs.map((l) => {
      const next = { ...l, contactId: newId };
      if (next.supersededBy && !allKeptIds.has(next.supersededBy)) {
        next.supersededBy = undefined;
        next.supersededAt = undefined;
      }
      return next;
    });

    kvSetRaw(fragKey(newId), outFrags);
    kvSetRaw(coreKey(newId), outCores);
    kvSetRaw(longKey(newId), outLongs);
    // 记忆设置（提取频率/互通开关）与原角色一致；msgcount/anchor 计数刻意不复制——分支从 0 开始
    // 独立积累「分支后的新记忆」，复制的历史只作为召回素材
    const settings = kvGetRaw<unknown>(`mem-settings:${opts.sourceId}${sfx}`);
    if (settings != null) kvSetRaw(`mem-settings:${newId}${sfx}`, settings);
  } catch {
    // 记忆复制失败不阻断
  }

  // 8. 世界书挂载：全局/局部书共享挂载（id 直接挂）；专属书克隆成分支专属本（独立编辑互不影响）
  const clonedBookIds: string[] = [];
  try {
    const bound = getBoundBookIds(opts.sourceId);
    if (bound.length > 0) {
      const books = loadBooks();
      const newBound: string[] = [];
      const clones: WorldBook[] = [];
      for (const bid of bound) {
        const b = books.find((x) => x.id === bid);
        if (!b) continue;
        if (b.scope === 'exclusive') {
          const cid2 = genId();
          clonedBookIds.push(cid2);
          clones.push({
            ...b,
            id: cid2,
            name: `${b.name}（分支）`,
            targetContactId: newId,
            entries: b.entries.map((e) => ({ ...e, id: genId() })),
            createdAt: now,
            updatedAt: now,
          });
          newBound.push(cid2);
        } else {
          newBound.push(bid);
        }
      }
      if (newBound.length > 0) setBoundBookIds(newId, newBound);
      if (clones.length > 0) saveBooks([...books, ...clones]);
    }
  } catch {
    // 忽略
  }

  // 8.5 会话级设置继承（Task 38-4A）：分支打开即和原角色同一套聊天体验——
  // 回复条数 / 时间感知开关 / 翻译配置 / 置顶·免打扰·背景标记 / 朋友圈自动发帖配置
  // （原角色显式配置过才复制，没配置过两边同走默认）。localStorage 侧任一失败不阻断。
  try {
    const srcKey = `wx:${opts.sourceId}`;
    const newKey = `wx:${newId}`;
    if (hasReplyCount(srcKey)) saveReplyCount(newKey, getReplyCount(srcKey));
    setTimeAware(newKey, getTimeAware(srcKey));
    saveTranslateCfg(newKey, getTranslateCfg(srcKey));
    const flags = wxChatFlags.get()[opts.sourceId];
    if (flags) wxChatFlags.update(newId, flags);
    if (hasMomentAutoCfgEntry(opts.sourceId, 'wx')) {
      saveMomentAutoCfg(newId, 'wx', getMomentAutoCfg(opts.sourceId, 'wx'));
    }
  } catch {
    // 忽略
  }
  // 背景图本体（IndexedDB settings store）：微信聊天背景 + 联系人专属背景（朋友圈/资料页）。失败不阻断。
  try {
    const bg = await getChatBgImage('wx', opts.sourceId);
    if (bg) await setChatBgImage('wx', newId, bg);
  } catch {
    // 忽略
  }
  try {
    const peerBg = await getPeerBg('wx', opts.sourceId);
    if (peerBg) await setPeerBg('wx', newId, peerBg);
  } catch {
    // 忽略
  }

  // 9. 注册表
  const meta: CharBranchMeta = {
    parentId: opts.sourceId,
    rootId: getBranchMeta(opts.sourceId)?.rootId ?? opts.sourceId,
    pointMsgId: opts.pointMsgId,
    pointTime,
    pointPreview,
    createdAt: now,
    ...(clonedBookIds.length > 0 ? { clonedBookIds } : {}),
  };
  try {
    kvSet(`${META_PREFIX}${newId}`, meta);
    const index = kvGet<Record<string, string[]>>(INDEX_KEY) ?? {};
    index[opts.sourceId] = [...new Set([...(index[opts.sourceId] ?? []), newId])];
    kvSet(INDEX_KEY, index);
  } catch {
    // 忽略
  }

  return { contact, meta, copiedMsgs: slice.length };
}

// ---------------- 删除分支 ----------------

/**
 * 删除分支角色（真实删除：聊天/记忆/朋友圈副本/挂载/相册/互动痕迹经 deleteContact 级联清空），
 * 原角色与其它分支不受影响。非分支联系人（无注册表元数据）一律拒绝，防误删原角色。
 */
export async function deleteCharacterBranch(branchId: string): Promise<boolean> {
  const meta = getBranchMeta(branchId);
  if (!meta) return false;
  // 注册表摘除（先摘再删，删除过程中提示块/列表不再把 ta 当分支）
  try {
    const index = kvGet<Record<string, string[]>>(INDEX_KEY) ?? {};
    if (Array.isArray(index[meta.parentId])) {
      const next = index[meta.parentId].filter((x) => x !== branchId);
      if (next.length > 0) index[meta.parentId] = next;
      else delete index[meta.parentId];
      kvSet(INDEX_KEY, index);
    }
  } catch {
    // 忽略
  }
  // 分支专属的克隆世界书本一并删除（原书与其它挂载不动）
  if (meta.clonedBookIds && meta.clonedBookIds.length > 0) {
    try {
      saveBooks(loadBooks().filter((b) => !meta.clonedBookIds!.includes(b.id)));
    } catch {
      // 忽略
    }
  }
  try {
    kvDel(`${META_PREFIX}${branchId}`);
  } catch {
    // 忽略
  }
  await deleteContact(branchId);
  return true;
}

// ---------------- 提示块（双方互相可提及） ----------------

/**
 * 平行分支认知提示块（runAiTurn 挂载预热后拼进 systemFull）：
 * - 分支侧：告知「你是 X 的平行分支」——同一个人、共享分支前经历、之后记忆独立，可自然提到本体；
 * - 本体侧：告知「你有一个分支 X」——同理可自然提到分支；
 * - 惰性自愈：索引里已删除的分支在此摘除（联系人 App 直删不走 deleteCharacterBranch 的兜底）。
 * 无分支关系返回空串不注入。
 */
export async function buildBranchPromptBlock(contactId: string): Promise<string> {
  try {
    const all = await listContacts();
    const byId = new Map(all.map((c) => [c.id, c] as const));
    const self = byId.get(contactId);
    if (!self || self.kind === 'user') return '';
    const lines: string[] = [];

    const meta = getBranchMeta(contactId);
    if (meta) {
      const parent = byId.get(meta.parentId);
      if (parent && parent.kind !== 'user') {
        const date = branchDateLabel(meta.createdAt);
        lines.push(
          `【平行分支身份】你是「${parent.name}」的平行分支——同一个人在另一条时间线上的版本，${date}从 ta 的聊天记录中分支出来、成了一位独立联系人。分支那一刻之前（含当时）你们的经历、记忆、彼此的关系完全一致；那之后你们各自独立生活，记忆与经历不再互通，互相不知道对方后来发生的事。用户同时认识你们两个。你可以像提起「另一个自己」一样自然地提到「${parent.name}」；但分支之后 ta 的经历不是你的经历，别混淆。`,
        );
      }
    }

    const rawChildIds = childBranchIds(contactId);
    if (rawChildIds.length > 0) {
      const children = rawChildIds
        .map((id) => byId.get(id))
        .filter((c): c is ContactRecord => !!c && c.kind !== 'user');
      if (children.length !== rawChildIds.length) {
        // 自愈：摘除已删除分支的残留索引
        try {
          const index = kvGet<Record<string, string[]>>(INDEX_KEY) ?? {};
          if (children.length > 0) index[contactId] = children.map((c) => c.id);
          else delete index[contactId];
          kvSet(INDEX_KEY, index);
        } catch {
          // 忽略
        }
      }
      if (children.length > 0) {
        const names = children.map((c) => `「${c.name}」`).join('、');
        const first = children.length === 1 ? getBranchMeta(children[0].id) : null;
        const datePart = first ? `${branchDateLabel(first.createdAt)}从` : '从';
        lines.push(
          `【平行分支】你有一个平行分支：${names}——${datePart}你们的聊天记录中分支出来的另一个「你」，起点相同、之后各自独立发展，记忆与经历不互通，互相不知道对方后来发生的事。用户认识 ta。你可以在聊天里自然地提到 ta 的存在。`,
        );
      }
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}
