/**
 * 消息收藏（微信 / QQ 双端共用存储模型；「信息」App 无收藏功能）：
 * - IndexedDB kv store 分端存储（启动时由 idb-kv 从 localStorage 迁移）：wx-favorites / qq-favorites
 * - 收藏项 = 原消息快照（文本 / 表情 / 图片 / 位置 / 卡片摘要）+ 来源会话信息
 * - 聊天气泡长按菜单「收藏」与多选批量收藏写入；收藏页（微信「我」/ QQ 个人抽屉）读取
 */

export type FavApp = 'wx' | 'qq';

export interface MsgFavorite {
  id: string;
  app: FavApp;
  /** 来源会话联系人 */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 原消息发送方：me=我发的，peer=对方发的 */
  msgRole: 'me' | 'peer';
  /** 内容类型：text / sticker / image / location / redpacket / transfer / family / forward */
  kind: string;
  /** 文本内容或占位描述（[图片] / [表情] xx / [位置] xx / [红包] …） */
  content: string;
  /** 原消息 id（同一消息只能收藏一次；旧数据无此字段则不去重） */
  msgId?: string;
  /** 图片消息原图（dataURL） */
  imgSrc?: string;
  /** 表情消息图 */
  stkUrl?: string;
  /** 原消息时间 */
  time: number;
  /** 收藏时间 */
  savedAt: number;
}

import { kvGet, kvSet } from './ios/idb-kv';

const LS_KEYS: Record<FavApp, string> = { wx: 'wx-favorites', qq: 'qq-favorites' };

export function favId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadFavorites(app: FavApp): MsgFavorite[] {
  try {
    const parsed: unknown = kvGet<MsgFavorite[]>(LS_KEYS[app]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MsgFavorite =>
        Boolean(x) &&
        typeof (x as MsgFavorite).id === 'string' &&
        typeof (x as MsgFavorite).content === 'string' &&
        typeof (x as MsgFavorite).contactId === 'string'
    );
  } catch {
    return [];
  }
}

export function saveFavorites(app: FavApp, list: MsgFavorite[]): void {
  try {
    kvSet(LS_KEYS[app], list.slice(-200));
  } catch {
    // 持久化失败忽略
  }
}

/** 追加一条收藏（插到最前；新收藏 id 由本模块生成） */
export function addFavorite(app: FavApp, item: Omit<MsgFavorite, 'id' | 'app' | 'savedAt'>): MsgFavorite {
  const full: MsgFavorite = { ...item, id: favId(), app, savedAt: Date.now() };
  saveFavorites(app, [full, ...loadFavorites(app)]);
  return full;
}

export function removeFavorite(app: FavApp, id: string): void {
  saveFavorites(app, loadFavorites(app).filter((x) => x.id !== id));
}

/** 某条消息是否已收藏过（每条消息只能收藏一次；按原消息 id 判断） */
export function isMsgFavorited(app: FavApp, msgId: string): boolean {
  return loadFavorites(app).some((x) => x.msgId === msgId);
}

/** 取消收藏某条消息（长按菜单「已收藏」再点一次 → 取消收藏，收藏页同步移除）：
 *  按原消息 id 找到收藏项后按收藏 id 删除；返回是否真的删除了（未收藏过返回 false） */
export function unfavoriteMsg(app: FavApp, msgId: string): boolean {
  const item = loadFavorites(app).find((x) => x.msgId === msgId);
  if (!item) return false;
  removeFavorite(app, item.id);
  return true;
}

/** 清空某联系人的全部收藏（会话级联清理用：群聊解散/退出后，来源会话已从本机删除，
 *  收藏页里以该会话为来源的收藏项成为孤儿，按 contactId（群 id）整批移除；
 *  内部 try/catch 吞错，清理失败不影响调用方的解散/退群主流程） */
export function purgeFavoritesForContact(app: FavApp, contactId: string): void {
  try {
    saveFavorites(app, loadFavorites(app).filter((x) => x.contactId !== contactId));
  } catch {
    // 忽略
  }
}
