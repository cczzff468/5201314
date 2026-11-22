'use client';

/**
 * 转发共享类型与格式化工具（微信 / QQ 聊天页共用）：
 * - 转发流程 UI 直接在聊天页内完成（多选勾选 → 逐条/合并 → 选目标会话），不再使用独立列表弹层
 * - FwdRecord：合并转发「聊天记录」卡片里每条对话的快照（持久化进各 App 消息模型的 fwd.records）
 */

/** 合并转发卡片 / 详情页里的一条对话记录 */
export interface FwdRecord {
  name: string;
  role: 'me' | 'peer';
  text: string;
  /** 原消息引用了其他消息时的引用行（「名字：内容」），详情页灰色小字展示 */
  quote?: string;
  time: number;
  /** 记录快照自带头像（转发时定格原说话人头像；详情页用它渲染，避免拿到转发目标会话的头像）。
   *  旧数据无此字段 → 详情页回退按 role 取当前会话头像 */
  avatar?: string | null;
  /** 原消息类型快照：表情包 / 图片在详情页显示原图，其余类型显示 text 文字（红包/转账/亲属卡/位置等） */
  kind?: 'text' | 'sticker' | 'image';
  /** 表情包 / 图片的图片地址（kind 为 sticker/image 时有值） */
  imgSrc?: string;
  /** 表情包语义（点击 toast 提示用） */
  stkMeaning?: string;
}

/** 转发目标（好友 + 自己） */
export interface FwdSheetTarget {
  id: string;
  name: string;
  avatar: string | null;
  /** 目标是否为「我自己」（显示「我自己」角标） */
  self?: boolean;
}

export type FwdMode = 'each' | 'merge';

/** 合并转发卡片标题：{我的名}与{对方名}的聊天记录 */
export function fwdRecordTitle(meName: string, peerName: string): string {
  return `${meName}与${peerName}的聊天记录`;
}

/** 详情页日期行：2026年9月15日 */
export function fwdRecordDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 详情页/记录行时间（对照原生微信聊天记录详情含秒）：18:29:41 */
export function fwdRecordTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
