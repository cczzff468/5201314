import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * 【AI 习惯记忆与条件反射系统】习惯提取 API
 * POST { longs: string[], cores: string[], userName?, peerName?, config?: UpstreamConfig }
 *
 * 把该联系人当前的「长期记忆 + 核心记忆」喂给 LLM，提取用户的作息与行为习惯，
 * 分三个维度：
 *   - time    时间习惯（如「每天早上 8 点会说早安」「通常晚上 11 点睡觉」）
 *   - behavior 行为习惯（如「每周五晚上会去玩王者荣耀」「心情不好时会频繁发短句」）
 *   - emotion  情绪习惯（如「深夜连续抱怨时通常是因为工作压力大」）
 *
 * 返回 { habits: Array<{ type, content, triggerMinute?, triggerDayOfWeek?, triggerWindowStart?, triggerWindowEnd? }> }
 * - triggerMinute：时间习惯的触发时刻（分钟数 0-1439，如 8:00=480）
 * - triggerDayOfWeek：行为习惯的触发星期几（0=周日 … 6=周六）
 * - triggerWindowStart/End：行为习惯的触发时段（分钟数 0-1439，如 18:00=1080 ~ 23:59=1439）
 *
 * 视角统一：只允许用双方真实名字指代（禁「对方/用户/我」混用）。
 * 客户端 mergeExtractedHabits 累加观察日期，跨 ≥5 天自动认定（confirmed=true）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

/** 名字归一化：去空白、限长；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

function buildSystem(userName: string, peerName: string): string {
  return [
    '你是用户习惯分析助手。从关于两个人的记忆中提取「用户（' + userName + '）」的作息与行为习惯，供 AI 角色做条件反射式互动。',
    '【视角规则（最高优先级，违反即无效）】',
    `- 只允许用「${userName}」（用户本人）和「${peerName}」（AI角色）这两个名字指代两人。`,
    '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称。',
    `- 习惯主语统一是 ${userName}（用户），不要把 AI 角色的行为算作用户习惯。`,
    '',
    '【提取维度】只提取稳定、可重复观察的习惯，偶发事件不算习惯：',
    '1. time（时间习惯）：' + userName + '在固定时间点会做的事，如「每天早上 8 点左右会说早安」「通常晚上 11 点前后睡觉」「中午 12 点会去吃饭」。需要 triggerMinute（分钟数 0-1439，8:00=480）。',
    '2. behavior（行为习惯）：' + userName + '在特定条件下会做的事，如「每周五晚上会去玩王者荣耀」「心情不好时会频繁发短句」「遇到开心事会连发语音」。可选 triggerDayOfWeek（0=周日…6=周六）+ triggerWindowStart/End（分钟数 0-1439，如 18:00=1080 ~ 23:59=1439）。',
    '3. emotion（情绪习惯）：' + userName + '的情绪触发规律，如「深夜连续抱怨时通常是因为工作压力大」「被忽视时会发傲娇的话」「聊到家人话题会变温柔」。',
    '',
    '【要求】',
    '- 每条习惯用一句简短自然语言描述（15-40 字），主语用 ' + userName + ' 的名字开头或隐含 ' + userName + '。',
    '- 只提取记忆里有明确证据的习惯，禁止推测和编造；记忆不足 3 条时不提取。',
    '- 最多提取 6 条最重要的习惯，按稳定性排序（天天发生的优先）。',
    '- 同一类别的习惯不要重复（如「每天 8 点早安」和「早上会说早安」算同一条，合并成一条带 triggerMinute）。',
    '',
    '只输出 JSON：{"habits": [{"type": "time|behavior|emotion", "content": "...", "triggerMinute": 480, "triggerDayOfWeek": 5, "triggerWindowStart": 1080, "triggerWindowEnd": 1439}]}',
    '（triggerMinute 仅 time 类型必填；triggerDayOfWeek/triggerWindowStart/triggerWindowEnd 仅 behavior 类型可选；emotion 类型不带触发时段字段）',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');
  const longs = Array.isArray(body.longs)
    ? body.longs.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const cores = Array.isArray(body.cores)
    ? body.cores.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  if (longs.length === 0 && cores.length === 0) {
    return NextResponse.json({ error: '记忆为空，无法提取习惯' }, { status: 400 });
  }

  // 拼装记忆原文（长期在前，核心在后；各取前 20 条防 token 爆炸）
  const memLines: string[] = [];
  longs.slice(0, 20).forEach((m: string, i: number) => memLines.push(`[长期${i + 1}] ${m}`));
  cores.slice(0, 20).forEach((m: string, i: number) => memLines.push(`[核心${i + 1}] ${m}`));

  const messages = [
    { role: 'system' as const, content: buildSystem(userName, peerName) },
    {
      role: 'user' as const,
      content: `以下是关于「${userName}」和「${peerName}」的记忆，请从中提取 ${userName} 的习惯：\n\n${memLines.join('\n')}`,
    },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ habits?: unknown }>(text);
    let habits: unknown = parsed?.habits;
    // JSON 解析失败时尝试从文本里正则抓 habits 数组
    if (!Array.isArray(habits)) {
      const m = text.match(/"habits"\s*:\s*(\[[\s\S]*?\])/);
      if (m) {
        try {
          habits = JSON.parse(m[1]);
        } catch {
          habits = [];
        }
      }
    }
    if (!Array.isArray(habits)) return NextResponse.json({ habits: [] });
    // 归一化输出：只保留合法字段
    const clean = habits
      .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
      .map((h) => ({
        type: typeof h.type === 'string' ? h.type : 'behavior',
        content: typeof h.content === 'string' ? h.content : '',
        triggerMinute: typeof h.triggerMinute === 'number' ? h.triggerMinute : undefined,
        triggerDayOfWeek: typeof h.triggerDayOfWeek === 'number' ? h.triggerDayOfWeek : undefined,
        triggerWindowStart: typeof h.triggerWindowStart === 'number' ? h.triggerWindowStart : undefined,
        triggerWindowEnd: typeof h.triggerWindowEnd === 'number' ? h.triggerWindowEnd : undefined,
      }))
      .filter((h) => h.content.trim().length > 0)
      .slice(0, 6);
    return NextResponse.json({ habits: clean });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '习惯提取失败' }, { status: 502 });
  }
}
