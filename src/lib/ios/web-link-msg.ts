'use client';

/**
 * 网页分享卡片消息（「AI 专属分屏浏览器」配套，第二十九轮）。
 *
 * sendWebLink 工具 / 用户发链接自动跟卡 往会话里插入 kind:'weblink' 消息：
 * 渲染为精美「网页分享卡片」（favicon + 标题 + 摘要 + 域名条），点击唤起 AI 分屏浏览器。
 *
 * 机制与 tool-status-bubble 完全同款：写会话 kv 存储 + 广播 'tool-status-msgs'
 * （三端聊天页现有监听器做按会话增量合并，无需新增监听）。
 */

import { kvGet, kvSet } from './idb-kv';
import { genId } from './db';
import { kvKeyForSession } from './tool-status-bubble';

export interface WebLinkCardData {
  url: string;
  title: string;
  /** 页面摘要（meta description 或正文前 120 字） */
  desc?: string;
  /** favicon URL（空 = 渲染首字母方块兜底） */
  favicon?: string;
}

interface WebLinkMsg {
  id: string;
  role: 'assistant' | 'peer';
  content: string;
  time: number;
  kind: 'weblink';
  weblink: WebLinkCardData;
}

/** 推一条网页分享卡片消息进会话（返回消息 id；sessionKey 空则静默跳过）。
 *  注意：不加 sys 标记——weblink 是正常可见消息（渲染走 kind 分支的精美卡片、
 *  AI 历史按 [网页] 序列化进上下文），不是 tool_status 那类系统提示行。 */
export function pushWebLinkBubble(sessionKey: string, card: WebLinkCardData): string {
  if (!sessionKey || !card.url) return '';
  const key = kvKeyForSession(sessionKey);
  const existing = kvGet<unknown[]>(key);
  const list = Array.isArray(existing) ? existing : [];
  const role: 'assistant' | 'peer' = sessionKey.startsWith('wx:') || sessionKey.startsWith('qq:') ? 'peer' : 'assistant';
  const id = genId();
  const msg: WebLinkMsg = {
    id,
    role,
    content: `[网页分享] ${card.title} ${card.url}`,
    time: Date.now(),
    kind: 'weblink',
    weblink: { url: card.url, title: card.title || card.url, desc: card.desc || '', favicon: card.favicon || '' },
  };
  kvSet(key, [...list, msg]);
  try {
    window.dispatchEvent(new CustomEvent('tool-status-msgs', { detail: { sessionKey } }));
  } catch {
    /* 忽略 */
  }
  return id;
}

/** 从一段文本里提取第一个 http(s) 链接（无 → null）。
 *  聊天发链接自动识别 + AI 判断「用户发了链接」共用。 */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s<>"'）)\]，。！？、；]+/i);
  if (m) return m[0];
  // 常见裸域名写法（www.xxx.com/yyy）——仅当词独立出现才认定，防误伤普通文字
  const m2 = String(text).match(/(?:^|[\s（(【\[])(www\.[a-z0-9-]+(?:\.[a-z]{2,})+)(\/[^\s<>"'）)\]，。！？、；]*)?/i);
  if (m2) return `https://${m2[1]}${m2[2] ?? ''}`;
  return null;
}
