/**
 * AI 视觉相册 + 视觉决策日志的本地 CRUD（IndexedDB）：
 * - albums（按 contactId 隔离）：每个 AI 角色拥有独立相册，存头像/朋友圈背景/聊天图本体
 * - visionDecisions（按 contactId 隔离）：AI 调视觉理解后选择的目标操作历史（换头像/换背景/存相册/挑相册等）
 *
 * 联系人删除时由 contacts-store.purgeChatTracesFor 动态 import 本模块做级联清理。
 */
import { localDB, genId, type AlbumRecord, type VisionDecisionRecord } from './db';

// ---------------- albums CRUD ----------------

/** 列出某联系人的相册条目（按 createdAt 升序，便于"按时间正序展示"的相册流） */
export async function listAlbums(contactId: string): Promise<AlbumRecord[]> {
  try {
    const list = await localDB.getAllFromIndex('albums', 'contactId', contactId);
    return (list as AlbumRecord[]).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/**
 * 聊天回合用的合并相册视图（第三十一轮）：AI 角色相册 + 机主相册合并升序返回。
 * 背景：「AI 存一张图到相册」现在双写（AI 自己的相册 + 机主的「我的相册」各一份，
 * 用户在微信/QQ「我的相册」页能直接看到 AI 存的图）；聊天侧的【相册清单】/选图兜底
 * 统一用本合并缓存，AlbumRecord.contactId 保留原归属，执行器据此区分「TA 的相册」与
 * 「机主的相册」（AI 两边都能选图设头像/发聊天）。
 * meId 与 peerId 相同（理论上不该发生）时只查一份，防重复条目。
 */
export async function listAlbumsForChat(peerId: string, meId: string): Promise<AlbumRecord[]> {
  try {
    const mine = await listAlbums(peerId);
    const owners = meId && meId !== peerId ? await listAlbums(meId) : [];
    return [...mine, ...owners].sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/**
 * 新增相册条目。opts.desc 识图描述、opts.name 备注/文件名、opts.origin 来源（默认 'user'）。
 * 返回写入的完整记录（含生成 id 与 createdAt）。
 */
export async function addAlbum(
  contactId: string,
  src: string,
  opts?: { desc?: string; name?: string; origin?: 'user' | 'ai' },
): Promise<AlbumRecord> {
  const rec: AlbumRecord = {
    id: genId(),
    contactId,
    src,
    desc: opts?.desc,
    name: opts?.name,
    origin: opts?.origin ?? 'user',
    createdAt: Date.now(),
  };
  await localDB.put('albums', rec);
  return rec;
}

/** 按 id 取单条；不存在或失败返回 null（不抛错，调用方按 null 兜底） */
export async function getAlbum(id: string): Promise<AlbumRecord | null> {
  try {
    const r = await localDB.get('albums', id);
    return r ?? null;
  } catch {
    return null;
  }
}

/** 更新条目（描述/备注）；条目不存在静默忽略（不报错不创建） */
export async function updateAlbum(id: string, patch: { desc?: string; name?: string }): Promise<void> {
  const cur = await getAlbum(id);
  if (!cur) return;
  await localDB.put('albums', { ...cur, ...patch });
}

/** 删除单条；失败静默忽略（联系人删除级联时单条失败不阻塞整体） */
export async function deleteAlbum(id: string): Promise<void> {
  try {
    await localDB.delete('albums', id);
  } catch {
    /* 忽略 */
  }
}

/** 删除某联系人的所有相册条目（联系人删除级联用） */
export async function deleteAlbumsByContact(contactId: string): Promise<void> {
  try {
    const list = await listAlbums(contactId);
    for (const a of list) await localDB.delete('albums', a.id);
  } catch {
    /* 忽略 */
  }
}

// ---------------- vision-decisions CRUD ----------------

/** 列出某联系人的视觉决策日志（按 createdAt 倒序，最近一次在最前，便于"最近一次换头像是哪张"查询） */
export async function listVisionDecisions(contactId: string): Promise<VisionDecisionRecord[]> {
  try {
    const list = await localDB.getAllFromIndex('visionDecisions', 'contactId', contactId);
    return (list as VisionDecisionRecord[]).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * 新增决策日志。调用方传除 id/createdAt 外的全部字段（contactId/app/action/targetId/imgSrc/reason）。
 * 失败静默忽略（决策日志属审计/历史信息，写入失败不应影响 AI 回复主流程）。
 */
export async function addVisionDecision(rec: Omit<VisionDecisionRecord, 'id' | 'createdAt'>): Promise<void> {
  try {
    await localDB.put('visionDecisions', { ...rec, id: genId(), createdAt: Date.now() });
  } catch {
    /* 忽略 */
  }
}

/** 删除某联系人的所有决策日志（联系人删除级联用） */
export async function deleteVisionDecisionsByContact(contactId: string): Promise<void> {
  try {
    const list = await listVisionDecisions(contactId);
    for (const d of list) await localDB.delete('visionDecisions', d.id);
  } catch {
    /* 忽略 */
  }
}
