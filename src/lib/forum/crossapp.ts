'use client';

/**
 * X论坛 · D3【跨 App 主动私聊】（v41）。
 *
 * 角色在论坛刷到并互动了机主的帖子之后，低概率「顺着论坛的事」主动来
 * 微信/QQ 找机主聊——此前只有被分享帖子才会回应，日常浏览互动不会引发
 * 私聊；本模块补上这条「真实社交关系」链路：
 *
 * - 触发：charEngage 成功（赞/评）后 ~12% 概率；同角色 6h 冷却不轰炸；
 * - 去重：同帖同角色只发一次（记忆碎片 commentId='crossapp-ping' 溯源）；
 * - 渠道：角色在哪个 App 是好友就发哪个（wx > qq；都不是则跳过）；
 * - 内容：一次 LLM 调用（人设 + 记忆互通 + 情绪 + 帖子上下文）1~2 句自然
 *   开话；失败静默（宁缺毋滥，不落「在吗」式模板垃圾）；
 * - 投递：scheduleAiDelivery 管线（延迟数秒 + 灵动岛通知 + 未读角标），
 *   与主动消息/分享回应同款；并写一条 source='forum' 记忆碎片。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { getContact, ownerProfileFor } from '@/lib/ios/contacts-store';
import { avatarFor, isFriendIn } from '@/lib/contacts';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { memAddForumFragment, memHasForumFragment, getMemSettings } from '@/lib/memory';
import { buildMoodBlock } from '@/lib/ios/ai-mood';
import { scheduleAiDelivery } from '@/lib/ios/ai-delivery';
import { pushChatNotification } from '@/lib/ios/island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { useSettings } from '@/lib/ios/store';
import { getActiveAccountIdFor, type AccountApp } from '@/lib/ios/accounts';
import { isPostMemoryOn, likesOf, isPostVisible, type ForumPost } from '@/lib/forum/core';
import { stripImgPh } from '@/lib/forum/imgph';
import type { ForumCharBrief } from './social';

/** 触发概率（charEngage 成功后） */
const PING_CHANCE = 0.12;
/** 同角色冷却（毫秒）：6h 内不重复主动私聊（同一角色不轰炸） */
const PING_COOL_MS = 6 * 3600_000;
/** 同帖同角色永久去重标记（记忆碎片 commentId） */
const PING_MEM_KIND = 'crossapp-ping';

/** 角色维度的冷却表（内存态；App 生命周期内有效） */
const lastPingAt = new Map<string, number>();

/** 提取 JSON 对象（与 forum-share 同款容错） */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

async function callPingLlm(system: string, userContent: string): Promise<string> {
  const apiConfig = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

/**
 * 角色互动后低概率跨 App 主动来私聊（engine.charEngage 成功路径调用）。
 * fire-and-forget：失败静默（宁缺毋滥——不落「在吗」式模板垃圾）。
 */
export async function maybeCrossAppPing(brief: ForumCharBrief, post: ForumPost, engageComment: string): Promise<void> {
  try {
    // 概率闸
    if (Math.random() > PING_CHANCE) return;
    // 同角色冷却（6h）
    const now = Date.now();
    if (now - (lastPingAt.get(brief.contactId) ?? 0) < PING_COOL_MS) return;
    // 同帖永久去重（记忆溯源）
    if (memHasForumFragment(brief.contactId, post.id, PING_MEM_KIND)) return;
    // 帖子仍可见（删帖不开话）
    if (!isPostVisible(post, now)) return;

    // 渠道：角色在哪个 App 是好友就发哪个（wx 优先，qq 兜底）
    const contact = await getContact(brief.contactId).catch(() => null);
    if (!contact || contact.kind !== 'char') return;
    const app: 'wx' | 'qq' | null = isFriendIn(contact, 'wx')
      ? 'wx'
      : isFriendIn(contact, 'qq')
        ? 'qq'
        : null;
    if (!app) return; // 哪都不是好友：不私聊

    lastPingAt.set(brief.contactId, now);

    const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
    const meName = owner?.realName || '机主';
    const persona = buildPersonaSystemPrompt(contact, {
      channel: app === 'wx' ? '微信' : 'QQ',
      userName: owner?.realName || null,
      ownerName: owner?.realName || null,
      accountId: getActiveAccountIdFor(app as AccountApp),
      multiApp: getMemSettings(contact.id).share,
    });
    const moodBlock = buildMoodBlock(contact.id);
    const system = [persona, moodBlock].filter(Boolean).join('\n\n');

    const bodyText = stripImgPh(post.content).slice(0, 400);
    const user = [
      `你刚在X论坛刷到${meName}发的帖子（${likesOf(post)} 赞），${engageComment ? `你还评论了一句：「${engageComment.slice(0, 60)}」` : '你给TA点了赞'}。`,
      `帖子内容：「${bodyText}」`,
      `现在你想直接去${app === 'wx' ? '微信' : 'QQ'}私聊TA——顺着这个帖子自然开话（可以接着你刚才的评论聊、可以问个具体的问题、可以吐槽或关心一句）。像平时给朋友发消息那样，1~2 句（10~60字），口语化，可以带一点点你的口头禅。不要复述帖子原文，不要说「我看到你的帖子」这种生硬开场白（真人不这么说）。`,
      '输出 JSON：{"text":"要发给TA的私信"}，除 JSON 外禁止任何文字。',
    ].join('\n');

    // LLM（失败重试 1 次；全失败静默——宁缺毋滥）
    let text = '';
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      const raw = await callPingLlm(system, user);
      const j = extractJsonObject(raw);
      const t = typeof j?.text === 'string' ? (j.text as string).trim() : '';
      if (t.length >= 6 && t.length <= 80) {
        text = t.replace(/^[「"'『]+|[」"'』]+$/g, '').replace(/\s+/g, ' ');
      }
    }
    if (!text) return;

    // 投递：延迟数秒 + 灵动岛通知 + 未读角标（与分享回应同管线）
    const sessionKey = `${app}:${contact.id}`;
    const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
    const { isProactiveChatActive } = await import('@/lib/ios/proactive-msg');
    await scheduleAiDelivery<{ id: string; role: 'peer'; content: string; time: number }>(
      sessionKey,
      [{ id: `fpin-${Date.now()}`, role: 'peer', content: text, time: Date.now() }],
      (m) => {
        try {
          const key = `${app}-chat-msgs:${contact.id}`;
          const cur = kvGet<unknown[]>(key);
          kvSet(key, [...(Array.isArray(cur) ? cur : []), m]);
        } catch {
          /* 静默 */
        }
        pushChatNotification({
          sessionKey,
          app: notifyApp,
          title: contact.name,
          avatar: avatarFor(contact, app),
          body: m.content,
          target: { app: notifyApp, contactId: contact.id },
        });
        if (!isProactiveChatActive(app, contact.id)) {
          if (app === 'wx') wxUnreads.bump(contact.id, 1);
          else qqUnreads.bump(contact.id, 1);
        }
      },
      { initialDelay: 4000 + Math.random() * 9000 },
    );

    // 记忆：我在论坛看到TA的帖子后主动去找TA聊了（去重标记也在这里落）。
    // v42【帖子记忆·金鱼】：开关关时不落库（去重退化为 6h 冷却 + 会话内存，可接受）
    try {
      if (isPostMemoryOn()) {
        memAddForumFragment(
          contact.id,
          `我在X论坛看到${meName}发的帖子（「${bodyText.slice(0, 50)}」）后，主动去${app === 'wx' ? '微信' : 'QQ'}找TA聊了这个事`,
          { postId: post.id, kind: 'share', commentId: PING_MEM_KIND },
        );
      }
    } catch {
      /* 静默 */
    }
  } catch {
    /* 全链路静默 */
  }
}
