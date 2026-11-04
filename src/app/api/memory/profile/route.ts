import { NextResponse, NextRequest } from 'next/server';
import { promptTextOf } from '@/lib/prompt-entries';

export const runtime = 'nodejs';

/**
 * 记忆库 · 画像图谱提取（用户画像事实层，Task 14-b B1）
 * POST { conversation: { role: 'me'|'peer', text: string }[], userName?: string, peerName?: string,
 *        existing?: { category, topic, content }[], config?: UpstreamConfig }
 * 返回 { facts: { category: 'like'|'dislike'|'habit'|'identity'|'date', topic, content, weight }[] }
 * （0-6 条；非法分类/空白 topic 丢弃，权重缺省按关键词自动分类兜底）
 * 与 /api/memory/extract 同一服务端模式：用户 API 配置优先（非流式代理），
 * z-ai-web-dev-sdk 兜底（completeWithFallback）；失败返回 502，客户端静默降级不阻塞聊天。
 * 只提取「稳定事实」（喜好/忌讳/习惯/身份/重要日子），一次性事件/临时安排/当下情绪一律忽略；
 * topic 是合并去重键（1~6 字关键词）：同一事物的变化沿用旧 topic（客户端按
 * contactId+category+topic 覆盖更新旧值而非堆叠，见 memory.ts upsertProfileFact）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';
import { normalizeWeight } from '@/lib/memory-core';

interface ConvoTurn {
  role: 'me' | 'peer';
  text: string;
}

function isConvoTurn(v: unknown): v is ConvoTurn {
  if (!v || typeof v !== 'object') return false;
  const r = v as { role?: unknown; text?: unknown };
  return (r.role === 'me' || r.role === 'peer') && typeof r.text === 'string' && r.text.trim().length > 0;
}

/** 名字归一化：去空白、限长（prompt 注入保持紧凑）；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

/** 当前时间锚点（北京时间）：2026年9月16日 星期三 14:32（与 extract 路由同款） */
function nowAnchor(now: Date): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const raw = fmt.format(now);
  return raw.replace('星期', ' 星期');
}

const CATEGORIES = ['like', 'dislike', 'habit', 'identity', 'date'] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  like: '喜好',
  dislike: '忌讳',
  habit: '习惯',
  identity: '身份',
  date: '重要日子',
};

function buildSystem(userName: string, peerName: string, nowLabel: string, existingText: string): string {
  // v63 全局预设管理器：画像提取提示词接入注册表（mem-profile；服务端读内存缓存；零破坏）
  return (
    promptTextOf(
      'mem-profile',
      { user: userName, peer: peerName, existing: existingText },
      [
    '你是用户画像整理助手。从一段聊天记录中提炼【稳定画像事实】，形成结构化的「画像图谱」条目。',
    '【视角规则（最高优先级，违反即无效）】',
    `- 这段对话发生在两个人之间：「${userName}」（用户本人）和「${peerName}」（AI角色）。`,
    `- 只提取关于「${userName}」（用户本人）的画像事实；「${peerName}」是 AI 角色，TA 的偏好/行为一律不要提取。`,
    '- 每条事实的陈述必须围绕用户本人；严禁出现「用户」「对方」「我」「你」「TA」等代称，直接写事实本身（如「不吃香菜」「熬夜到凌晨1点」）。',
    '【只提取这五类稳定事实】',
    `- identity（身份）：姓名/职业/城市/学校/家庭角色等长期身份信息（${CATEGORY_LABEL.identity}类）`,
    `- like（喜好）：爱吃/爱玩/喜欢的事物（口味、颜色、爱好、歌手…）→（${CATEGORY_LABEL.like}类）`,
    `- dislike（忌讳）：不吃/过敏/讨厌/反感的事物（忌口、雷点）→（${CATEGORY_LABEL.dislike}类）`,
    `- habit（习惯）：作息/口味惯例/日常习惯（熬夜、每周打球、奶茶去冰…）→（${CATEGORY_LABEL.habit}类）`,
    `- date（重要日子）：生日/纪念日/固定日程（每月几号发工资、周年…）→（${CATEGORY_LABEL.date}类）`,
    '【不要提取】一次性事件、临时安排（明天开会、这周加班、下次去哪）、当下情绪、寒暄客套、',
    '对话里偶尔一提且不像长期偏好的内容——这些交给记忆碎片管线，画像只留长期稳定的事实。',
    '【topic 规则（合并去重键，务必遵守）】',
    '- topic 是这一类事物的关键词（1~6 个字，如「香菜」「熬夜」「生日」「辣」）。',
    '- 同一事物沿用同一个 topic：旧画像已有 topic「辣」，这次说「现在能吃一点微辣了」，topic 仍写「辣」；',
    '  不同事物用不同 topic。topic 写错会导致同一事实重复占位。',
    '【content 规则】一句话陈述（25 字内）、自含主语：写「不吃香菜」而不是「不吃」；写「熬夜到凌晨1点」而不是「熬夜」。',
    '【weight 规则】high = 身份/过敏忌口等健康禁忌/重要日子；low = 表述含糊或偶一提及的偏好；normal = 其余。',
    '- 最多 6 条；对话里没有值得记的稳定事实就给空数组；禁止推测和编造。',
    `只输出 JSON：{"facts":[{"category":"like","topic":"...","content":"...","weight":"high"|"normal"|"low"}]}（category 只能取 ${CATEGORIES.join(' / ')}）`,
    ...(existingText
      ? [`【已有画像（同 topic 的新说法=更新这条，沿用旧 topic；矛盾变化如旧「不吃辣」新「能吃微辣」同样沿用旧 topic 覆盖）】${existingText}`]
      : []),
  ].join('\n'),
    ) ?? ''
  );
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const convo = Array.isArray(body.conversation) ? body.conversation.filter(isConvoTurn) : [];
  if (convo.length < 2) return NextResponse.json({ error: '对话内容太少，无法提取画像' }, { status: 400 });

  // 视角统一：me=用户本人（真实名字优先），peer=AI 角色；缺省回退固定称呼且全批一致
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');

  // 已有画像（更新对照用）：非法条目丢弃，最多带 40 条进 prompt
  const existingRaw = Array.isArray(body.existing) ? body.existing : [];
  const existing = existingRaw
    .map((e: unknown) => {
      const o = e as { category?: unknown; topic?: unknown; content?: unknown };
      if (
        o &&
        typeof o === 'object' &&
        typeof o.category === 'string' &&
        (CATEGORIES as readonly string[]).includes(o.category) &&
        typeof o.topic === 'string' &&
        typeof o.content === 'string'
      ) {
        return `${CATEGORY_LABEL[o.category as Category]}·${o.topic.trim().slice(0, 12)} → ${o.content.trim().slice(0, 40)}`;
      }
      return null;
    })
    .filter((e: string | null): e is string => e !== null)
    .slice(0, 40);
  const existingText = existing.length > 0 ? `\n${existing.join('；')}` : '';

  const convoText = convo
    .slice(-30)
    .map((t) => `${t.role === 'me' ? userName : peerName}：${t.text.slice(0, 400)}`)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: buildSystem(userName, peerName, nowAnchor(new Date()), existingText) },
    { role: 'user' as const, content: `聊天记录：\n${convoText}` },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ facts?: unknown }>(text);
    const rawFacts = parsed && Array.isArray(parsed.facts) ? parsed.facts : [];
    const facts: { category: Category; topic: string; content: string; weight: 'high' | 'normal' | 'low' }[] = [];
    for (const x of rawFacts) {
      if (!x || typeof x !== 'object') continue;
      const o = x as { category?: unknown; topic?: unknown; content?: unknown; weight?: unknown };
      const topic = typeof o.topic === 'string' ? o.topic.trim().slice(0, 12) : '';
      const content = typeof o.content === 'string' ? o.content.trim().slice(0, 60) : '';
      if (!topic || !content) continue;
      if (typeof o.category !== 'string' || !(CATEGORIES as readonly string[]).includes(o.category)) continue;
      facts.push({
        category: o.category as Category,
        topic,
        content,
        weight: normalizeWeight(o.weight, content),
      });
      if (facts.length >= 6) break;
    }
    // 解析失败不做按行兜底（画像必须有 category/topic 结构，缺结构的行没有合并键，
    // 入库只会重复堆叠）——解析失败如实返回空数组，客户端静默跳过本窗口
    return NextResponse.json({ facts });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '画像提取失败' }, { status: 502 });
  }
}
