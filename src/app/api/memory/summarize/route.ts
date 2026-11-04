import { NextResponse, NextRequest } from 'next/server';
import { promptTextOf } from '@/lib/prompt-entries';

export const runtime = 'nodejs';

/**
 * 记忆库 · 总结为更高一层记忆
 * POST { fragments: string[], level?: 'core'|'long', userName?: string, peerName?: string, config?: UpstreamConfig }
 * - level='core'（默认）：多条「记忆碎片」→ 一条「核心记忆」
 * - level='long'：多条「核心记忆」→ 一条「长期记忆」（记忆层级顶层，最稳定画像）
 * 返回 { summary: string }（用户 API 配置优先，失败回退内置 SDK）
 * 视角统一：只允许用双方真实名字指代（禁「对方/用户/我」混用）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

/** 名字归一化：去空白、限长；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

function perspectiveRules(userName: string, peerName: string, participants: string[] = []): string[] {
  if (participants.length) {
    return [
      '【视角规则（最高优先级，违反即无效）】',
      `- 这些记忆来自群聊场景，涉及的人物可能不止两位：除了「${userName}」（用户本人）与「${peerName}」（AI角色），还可能提到这些群成员：${participants.slice(0, 30).join('、')}（或记忆原文里已出现的其他具体成员名字）。`,
      '- 指代人物只允许用具体名字（上面列出的成员名或原文里已有的名字），严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等代称。',
      '- 每条信息必须保留原文的归属：谁的事就写谁的名字，严禁把其他成员的事改写成「' + userName + '」或「' + peerName + '」的事。',
    ];
  }
  return [
    '【视角规则（最高优先级，违反即无效）】',
    `- 只允许用「${userName}」（用户本人）和「${peerName}」（AI角色）这两个名字指代两人。`,
    '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称。',
    '- 每条信息必须写明属于谁：先判断说的是谁的事，再把名字写进主语。',
    `- 若原文里出现这两人之外的其他具体人名，保留原名字、照实归因，不要改写成两人的事。`,
    `- 例：${userName}明天不上班、${peerName}喜欢打球、${peerName}称${userName}为唯一交心的朋友。`,
  ];
}

/**
 * 【fix3-a 1 / fix3-a 11】core/long 两个 prompt 共同新增的两条要求：
 * - 归属保留：原文里的角色标注（（AI角色本人）/（用户本人））与场景词（在微信朋友圈/QQ空间、在群里等）
 *   必须原样保留，浓缩时不得丢失归属信息（否则召回侧归属说明行兜底失效）；
 * - 跨名合并：同一人以不同叫法（昵称/备注/真名）出现的记忆要合并为一条，不要当成两个人。
 */
const SUMMARY_ATTRIB_RULES = [
  '- 原文中的（AI角色本人）/（用户本人）标注与『在微信朋友圈/QQ空间』『在群里』等场景词必须原样保留，浓缩时不得丢失归属信息。',
  '- 同一个人可能在不同记忆里以不同叫法出现（昵称/备注/真名），指同一人的记忆要合并为一条，不要当成两个人。',
];

function buildSystem(level: 'core' | 'long', userName: string, peerName: string, participants: string[] = []): string {
  // v63 全局预设管理器：记忆总结提示词接入注册表（mem-summarize-long / mem-summarize-core /
  // mem-summarize-attrib，服务端读 /api/settings/prompt-state 内存缓存；原文作 dynamicDefault 零破坏）
  const attribBlock = promptTextOf('mem-summarize-attrib', undefined, SUMMARY_ATTRIB_RULES.join('\n'));
  const attribLines = attribBlock == null ? [] : attribBlock.split('\n');
  if (level === 'long') {
    return (
      promptTextOf(
        'mem-summarize-long',
        {
          perspective: perspectiveRules(userName, peerName, participants).join('\n'),
          attrib: attribLines.join('\n'),
        },
        [
          '你是记忆总结助手。把多条「核心记忆」浓缩成一条「长期记忆」（最稳定的人物画像）。',
          ...perspectiveRules(userName, peerName, participants),
          '要求：',
          '- 一段话，120 字以内，只保留长期稳定的事实、偏好、承诺与关系本质，省略已经过时的临时细节',
          '- 信息冲突时以更晚的核心记忆为准；禁止推测和编造',
          '- 语言自然、第三人称叙述，不要罗列条目',
          ...attribLines,
          '只输出 JSON：{"summary": "..."}',
        ].join('\n'),
      ) ?? ''
    );
  }
  return promptTextOf(
    'mem-summarize-core',
    {
      perspective: perspectiveRules(userName, peerName, participants).join('\n'),
      attrib: attribLines.join('\n'),
    },
    [
    // 【fix3-a 1】core 分支此前丢了 participants（long 分支已传）：群来源碎片被强制按二人视角
    // 浓缩，其他成员的事被改成用户/角色的事（归属坍塌）；有 participants 时开头文案同步改为群聊口径
    participants.length
      ? '你是记忆总结助手。把一段群聊相关的多条『记忆碎片』浓缩成一条『核心记忆』。'
      : '你是记忆总结助手。把关于同两个人的多条「记忆碎片」浓缩成一条「核心记忆」。',
    ...perspectiveRules(userName, peerName, participants),
    '要求：',
    '- 一段话，80 字以内，覆盖最重要的长期事实、偏好、承诺与关系进展',
    '- 信息冲突时以更晚的碎片为准；禁止推测和编造',
    '- 语言自然、第三人称叙述，不要罗列条目',
    ...attribLines,
    '只输出 JSON：{"summary": "..."}',
  ].join('\n'),
  ) ?? '';
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const level: 'core' | 'long' = body.level === 'long' ? 'long' : 'core';
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');
  // 群聊来源：成员显示名（有名单时按实际人物归因，不强制二人视角）；【fix3-a 3】解析上限 20→30 与 extract 侧一致
  const participants = Array.isArray(body.participants)
    ? body.participants
        .map((v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 20) : ''))
        .filter((v: string) => v.length > 0)
        .slice(0, 30)
    : [];
  const items = Array.isArray(body.fragments)
    ? body.fragments.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  if (items.length < 2) return NextResponse.json({ error: '数量太少，无需总结' }, { status: 400 });

  const messages = [
    { role: 'system' as const, content: buildSystem(level, userName, peerName, participants) },
    {
      role: 'user' as const,
      content: `${level === 'long' ? '核心记忆' : '记忆碎片'}：\n${items
        .slice(0, 40)
        .map((f: string, i: number) => `${i + 1}. ${f}`)
        .join('\n')}`,
    },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ summary?: unknown }>(text);
    let summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const parsedOk = Boolean(parsed);
    if (!summary && !parsedOk) {
      // JSON 解析失败才取第一段有效文本（解析成功但空 = 上游异常，如实报错）
      summary =
        text
          .split('\n')
          .map((l) => l.replace(/^[-*\d.、\s]+/, '').trim())
          .find((l) => l.length >= 8) ?? '';
    }
    if (!summary) return NextResponse.json({ error: '总结结果为空' }, { status: 502 });
    return NextResponse.json({ summary: summary.slice(0, level === 'long' ? 400 : 300) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '总结失败' }, { status: 502 });
  }
}
