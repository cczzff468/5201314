import { NextRequest, NextResponse } from 'next/server';
import { completeWithFallback, extractUpstreamConfig, readJsonBody } from '@/lib/server-llm';

export const runtime = 'nodejs';

/**
 * 「文字图片」卡片文字代笔（信息/微信/QQ 加号面板 → 文字图片，输入留空时调用）：
 * 文字图片是「用户」发给聊天对象的卡片——把「角色人设 + 最近聊天记录」交给 LLM，
 * 让它以用户第一人称代写一段适合印在卡片上的文字（手写便签/心情签风）；
 * 客户端把文字以「我」发出的「文字图片」卡片消息上屏并触发 AI 回合——
 * 不依赖图像生成接口（无需配置「设置 → 图像生成」）。
 *
 * 请求：{ config?: { baseUrl, apiKey, model, temperature?, maxTokens? },
 *        charName, channel?, persona?, history?: string[] }
 * 响应：{ text } / { error }（上游与内置 SDK 兜底都失败时 502）
 */
export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });

  const charName =
    typeof body.charName === 'string' && body.charName.trim() ? body.charName.trim().slice(0, 40) : '对方';
  const channel = typeof body.channel === 'string' ? body.channel.trim().slice(0, 20) : '';
  const persona = typeof body.persona === 'string' ? body.persona.trim().slice(0, 1200) : '';
  const history = Array.isArray(body.history)
    ? body.history
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(-14)
        .map((s) => s.trim().slice(0, 120))
    : [];
  const config = extractUpstreamConfig(body.config);

  const system = [
    `用户正在${channel ? `${channel}里` : ''}给聊天对象「${charName}」写一张「文字图片」卡片（印着字的卡片消息）。`,
    persona ? `对方「${charName}」的人设（供参考，遵守其中的身份/年龄/性格/关系设定）：\n${persona}` : '',
    '你的任务：代笔——以「用户（我）」的第一人称，结合最近的聊天记录、你们的关系与当下心境，写一段「我会写在卡片上发给 TA」的文字，像一张手写便签/心情签。',
    [
      '输出要求：',
      '1. 只输出卡片上的文字本身，30 到 80 字，可分一到两行短句；',
      '2. 用「我」（用户）的口吻第一人称，写给 TA（贴合 TA 的人设与当下聊天氛围：随感/心事/小诗/情话/问候皆可）；',
      '3. 自然有生活气，不要客套开场白、不要解释说明、不要落款署名和日期；',
      '4. 不要序号、引号或「卡片：」之类前缀，直接输出正文。',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const userMsg = [
    history.length > 0 ? `最近聊天记录（我：=用户，TA：=对方）：\n${history.join('\n')}` : '（还没有聊天记录，按你们的关系自由发挥一张符合当下心境的卡片）',
    '现在直接输出卡片上的文字：',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const { text } = await completeWithFallback(config, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ]);
    // 清洗：去代码围栏 → 去整体引号/书名号包裹 → 压缩空行 → 截断（卡片容量有限）
    const cleaned = text
      .trim()
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/, '')
      .replace(/^[「『"'“”‘’《【(（]+/, '')
      .replace(/[」』"'“”‘’》】)）]+$/, '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 160)
      .trim();
    if (!cleaned) return NextResponse.json({ error: 'AI 没有返回有效的卡片文字' }, { status: 502 });
    return NextResponse.json({ text: cleaned });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '卡片文字生成失败，请重试' },
      { status: 502 },
    );
  }
}
