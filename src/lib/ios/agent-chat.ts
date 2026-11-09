'use client';

/**
 * 语音会话大脑（v1.7.1「专属人设智能体」）：
 *
 * 语音会话里用户说的每一句话经 voiceTurn 统一路由，一次 LLM 调用同时完成
 * 「闲聊回复」与「任务识别」——像小爱同学/Siri：问候/闲聊/提问用人设口语化回复，
 * 「打开微信」「创建一个联系人叫XX性格XX」这类要动手机的话整理成任务交给 Agent。
 *
 * - 人设注入：内置专属人设「小灵」（assistant-persona，与小爱/Siri 同级的独立智能体，
 *   有自己的名字/性格/说话风格），名字跟随唤醒名、机主名字注入，不再借用联系人角色；
 * - 输出协议：严格 JSON {"mode":"chat","reply":"…"} 或 {"mode":"task","task":"…"}；
 *   模型没按格式输出时兜底解析（整段文本当回复；命中任务动词当任务）；
 * - 场景约束：回复必须口语化、1~3 句、适合 TTS 朗读（无 Markdown/表情/列表）。
 */

import { extractJsonObject } from './call-upstream';
import { useSettings } from './store';
import { cachedOwnerName } from './contacts-store';
import { getAgentVoiceCfg } from './agent-voice';
import { ASSISTANT_DEFAULT_NAME, assistantFallbackReply, buildAssistantPersonaPrompt } from './assistant-persona';

// ============================================================
// A. 类型与常量
// ============================================================

export interface VoiceTurn {
  role: 'user' | 'agent';
  text: string;
}

export type VoiceTurnResult =
  | { mode: 'chat'; reply: string }
  | { mode: 'task'; task: string };

/** 路由/回复超时（语音场景等不了太久） */
const VOICE_LLM_TIMEOUT_MS = 45_000;

/** 兜底任务动词：接口失败时判定「该当任务处理」的强操作信号 */
const TASK_VERB_RE =
  /打开|关闭|退出|发(一条?|个)?(消息|短信|微信|qq|邮件)|给.{1,8}(发|说)|创建|新建|添加|删(除|掉)|设置|修改|查询|查一?下|搜(索|一下)|播放|放(一首?|首歌)|暂停|下一首|上一首|写(一?条)?(备忘录|提醒|笔记)|记一?(条|下|笔)|提醒我|下单|点外卖|订(个|一?)|叫(车|外卖)|转账|付款|导航(去|到)?|拍(照|张照)|截屏|截图|清空|帮我(看|办|弄|做)/;

/** 接口失败时的聊天兜底回复（保持人设，随机挑一条） */
const chatFallback = (): string => assistantFallbackReply();

// ============================================================
// B. LLM 调用（照抄 planWithLLM 的纯文本流聚合）
// ============================================================

async function callChatLLM(
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<string | null> {
  const apiCfg = useSettings.getState().apiConfig;
  // 照抄 chat-stream-store/planWithLLM 的 effConfig 构造：抬高 maxTokens 下限防 JSON 截断
  const effConfig = { ...apiCfg, maxTokens: Math.max(apiCfg.maxTokens, maxTokens) };
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), VOICE_LLM_TIMEOUT_MS);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, config: effConfig }),
      signal: ctl.signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
    }
    return full.trim() || null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

// ============================================================
// C. 人设注入
// ============================================================

let personaCache: { key: string; sys: string; at: number } | null = null;
const PERSONA_CACHE_TTL = 60_000;

/**
 * 语音会话 system prompt：专属人设（assistant-persona）+ 语音场景约束 + 路由/输出协议。
 * 名字跟随唤醒名；人设 60s 内缓存（键含名字，改唤醒名立即换名；避免每句都重拼）。
 */
async function buildVoiceSystemPrompt(): Promise<string> {
  const name = getAgentVoiceCfg().name || ASSISTANT_DEFAULT_NAME;
  if (personaCache && personaCache.key === name && Date.now() - personaCache.at < PERSONA_CACHE_TTL) {
    return personaCache.sys;
  }
  const sys = [
    buildAssistantPersonaPrompt(name, cachedOwnerName() || null),
    '【当前场景】你正在和机主语音对话（手机顶层的语音助手会话）。你的回复会被朗读出来，所以必须：',
    '- 口语化，像说话不像写字；一轮 1~3 句，不要长篇大论；',
    '- 不要用任何 Markdown、列表、表情符号、括号动作描写（如「微笑」）。',
    '【你的双重职责】',
    '1) 闲聊/问候/提问/情感陪伴：直接用你的人设自然回复。',
    '2) 操作手机：如果机主的话需要你动手操作这台手机——打开某个应用、发消息、创建联系人/备忘录/提醒事项、查天气、放歌、下单、改设置等任何具体操作——就输出任务模式，把话整理成一句清晰的任务描述（保留原意与关键参数，比如名字/内容/性格描述）。',
    '【输出格式】严格输出一个 JSON 对象，前后不带任何其他文字、不用 markdown 代码块包裹：',
    '- 纯聊天：{"mode":"chat","reply":"<你的人设口语回复，1~3句>"}',
    '- 要动手：{"mode":"task","task":"<整理后的任务描述>"}',
    '【判定规则】出现操作动词或应用名（打开/发/建/创建/删/设/查/放/搜/订/写/记/提醒/下单…）→ task；打招呼/闲聊/情绪陪伴/知识问答 → chat；拿不准 → chat。',
  ].join('\n');
  personaCache = { key: name, sys, at: Date.now() };
  return sys;
}

// ============================================================
// D. 语音回合路由（聊天回复 + 任务识别一体）
// ============================================================

/** 历史条数上限（控制 token；语音多轮足够） */
const HISTORY_MAX = 10;

/** 清理回复文本：去包裹引号/前后缀、截断 */
function cleanReply(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^[「"'『]?|[」"'』]$/g, '').trim();
  if (t.length > 300) t = `${t.slice(0, 297)}…`;
  return t;
}

/**
 * 语音会话一回合：路由闲聊 vs 任务（一次 LLM 调用，人设一致）。
 * 永不抛错也不返回 null：接口挂/解析失败按 TASK_VERB_RE 兜底成任务，否则兜底回复。
 */
export async function voiceTurn(text: string, history: VoiceTurn[]): Promise<VoiceTurnResult> {
  const t = text.trim();
  if (!t) return { mode: 'chat', reply: chatFallback() };
  const sys = await buildVoiceSystemPrompt();
  const msgs: { role: string; content: string }[] = [{ role: 'system', content: sys }];
  for (const h of history.slice(-HISTORY_MAX)) {
    msgs.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text.slice(0, 400) });
  }
  msgs.push({ role: 'user', content: t });

  const full = await callChatLLM(msgs, 600);
  if (full) {
    const obj = extractJsonObject(full);
    if (obj && typeof obj === 'object') {
      const mode = obj.mode === 'task' ? 'task' : obj.mode === 'chat' ? 'chat' : null;
      if (mode === 'task') {
        const task = typeof obj.task === 'string' ? obj.task.trim() : '';
        if (task) return { mode: 'task', task };
      }
      if (mode === 'chat') {
        const reply = typeof obj.reply === 'string' ? cleanReply(obj.reply) : '';
        if (reply) return { mode: 'chat', reply };
      }
    }
    // 没按格式输出：整段当回复（多数情况是聊天漏了 JSON 壳）；纯长文含任务动词另判
    const asReply = cleanReply(full);
    if (asReply && !TASK_VERB_RE.test(t)) return { mode: 'chat', reply: asReply };
  }
  // 兜底：接口挂/解析失败——任务动词明显就直接当任务，否则兜底回复
  if (TASK_VERB_RE.test(t)) return { mode: 'task', task: t };
  return { mode: 'chat', reply: chatFallback() };
}
