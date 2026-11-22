/**
 * 「文字图片」卡片（信息/微信/QQ 三端加号面板共用）：不走图像生成管线——
 * AI 根据角色人设 + 最近聊天记录写一段卡片文字，客户端以「文字图片」卡片消息发出。
 * 走 /api/textcard（用户上游优先、服务端内置模型兜底）；失败抛错由调用方展示。
 */

/** 客户端聊天模型配置（设置 › API 设置；null = 服务端直接用内置模型兜底） */
export type CardTextConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
} | null;

export async function autoCardText(args: {
  config: CardTextConfig;
  charName: string;
  channel: '短信' | '微信' | 'QQ';
  /** 角色人设（联系人 persona；小助手会话可空） */
  persona?: string;
  /** 最近聊天记录（buildPhotoDescHistory 产物，「我：… / TA：…」短行） */
  history?: string[];
}): Promise<string> {
  const res = await fetch('/api/textcard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok && data && typeof data === 'object') {
    const t = (data as { text?: unknown }).text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  const msg = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  throw new Error(typeof msg === 'string' && msg ? msg : '卡片文字生成失败，请重试');
}
