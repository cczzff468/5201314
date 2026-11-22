/**
 * 阅读 App · AI 陪读服务层（仅服务端）
 * ---------------------------------------------------------------------------
 * Token 危机解法（用户需求原话：一章两三千字，每次聊天都发三千字，额度几轮就烧光）：
 * 1. 翻章时后台静默调用小模型把本章压成 ~100 字剧情摘要（genChapterSummary）
 * 2. 聊天时只注入：当前书信息卡（书名/总章数/进度/剩余）+ 已读章节摘要 + 最近对话
 *    + 长期记忆（历史读书里程碑 + 书架在读列表），正文本身永不进上下文
 * 3. 所有对话/摘要/里程碑写 ReadingMemory（=「看过什么书、书的内容、聊过的天」全记忆）
 *
 * 多条消息回复（用户需求：AI 一次回 3~10 条消息，像真人连发）：
 * - 提示词要求模型把回复拆成多条短消息，条间用 ||| 分隔；
 * - splitAiReply 容错拆分（||| / 换行 / 句号兜底切句），上限 10 条；
 * - 每条独立落 ReadingMemory（历史回放时天然就是多条气泡）。
 */
import { db } from '@/lib/db';
import type { LLMMessage } from '@/lib/server-llm';

interface ZAIClient {
  chat: {
    completions: {
      create: (body: {
        model?: string;
        messages: LLMMessage[];
        stream?: boolean;
        thinking?: { type: 'enabled' | 'disabled' };
        [k: string]: unknown;
      }) => Promise<{ choices?: { message?: { content?: string } }[] }>;
    };
  };
}

let zaiCache: ZAIClient | null = null;
async function getZai(): Promise<ZAIClient> {
  if (zaiCache) return zaiCache;
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  zaiCache = (await ZAI.create()) as unknown as ZAIClient;
  return zaiCache;
}

/** 轻量补全（禁思考链，省 Token；AI 助读三件套也复用） */
export async function lightChat(messages: LLMMessage[], maxTokens = 512): Promise<string> {
  const zai = await getZai();
  const res = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  const text = res?.choices?.[0]?.message?.content || '';
  return text.trim();
}

// ---------------------------------------------------------------------------
// 章节摘要（~100字，翻章后台静默生成）
// ---------------------------------------------------------------------------

export async function genChapterSummary(p: {
  bookUrl: string;
  chapterUrl: string;
  index: number;
  title: string;
  content: string;
}): Promise<string> {
  const head = p.content.slice(0, 2600);
  const text = await lightChat(
    [
      {
        role: 'system',
        content:
          '你是小说剧情压缩器。把用户给的章节内容压缩成100字左右的剧情摘要：交代关键事件、人物动向、重要伏笔。直接输出摘要正文，不要任何前缀、标题或解释。若内容是公告/请假/无剧情，输出「（本章无正文剧情：…一句说明…）」。',
      },
      { role: 'user', content: `【${p.title || `第${p.index + 1}章`}】\n${head}` },
    ],
    260,
  );
  const summary = text.slice(0, 160);
  if (summary) {
    await db.chapterCache
      .update({ where: { chapterUrl: p.chapterUrl }, data: { summary } })
      .catch(() => null);
    await db.readingMemory
      .create({
        data: { bookUrl: p.bookUrl, kind: 'summary', chapterIndex: p.index, content: summary },
      })
      .catch(() => null);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// AI 陪读聊天
// ---------------------------------------------------------------------------

export interface ChatBookCtx {
  name: string;
  author?: string | null;
  currentChapter: number; // 0-based
  currentChapterTitle: string;
  totalChapters: number;
}

/** 拼装陪读上下文：当前章原文节选 + 已读全部章节摘要 + 最近对话 + 记忆
 *  （用户明确要求：AI 要知道这本书的全部内容与当前内容；摘要来自翻章时静默生成） */
async function buildChatContext(
  bookUrl: string,
  book: ChatBookCtx,
  chapterUrl: string | undefined,
  persona?: string,
  memoryBlock?: string,
): Promise<LLMMessage[]> {
  const remain = Math.max(0, book.totalChapters - book.currentChapter - 1);
  // —— 当前章原文（客户端传 chapterUrl；缓存命中直接取，未命中拉最近读过的一章） ——
  let curText = '';
  let curTitle = book.currentChapterTitle;
  if (chapterUrl) {
    const cur = await db.chapterCache.findUnique({ where: { chapterUrl } }).catch(() => null);
    if (cur?.content) {
      curText = cur.content;
      curTitle = cur.title || curTitle;
    }
  }
  if (!curText) {
    const near = await db.chapterCache.findFirst({
      where: { bookUrl, chapterIndex: book.currentChapter },
      orderBy: { fetchedAt: 'desc' },
    }).catch(() => null);
    if (near?.content) {
      curText = near.content;
      curTitle = near.title || curTitle;
    }
  }
  // 当前章原文节选：头部 2400 字 + 尾部 1000 字（首尾最有信息量）
  const curExcerpt =
    curText.length > 3600 ? `${curText.slice(0, 2400)}\n……（中略）……\n${curText.slice(-1000)}` : curText;
  // —— 已读全部章节摘要（chapterCache 逐章缓存；只取 ≤ 当前进度，不剧透） ——
  const summaryRows = await db.chapterCache
    .findMany({
      where: { bookUrl, summary: { not: null } },
      orderBy: { chapterIndex: 'asc' },
      take: 200,
    })
    .catch(() => [] as { chapterIndex: number; title: string; summary: string | null }[]);
  const sumLines: string[] = [];
  let sumChars = 0;
  for (const s of summaryRows) {
    if (s.chapterIndex > book.currentChapter) break; // 未读章节不进上下文（防剧透）
    const line = `第${s.chapterIndex + 1}章：${s.summary || ''}`;
    if (sumChars + line.length > 10000) {
      sumLines.push(`……（更早章节摘要过长已省略，共 ${summaryRows.length} 章有摘要）`);
      break;
    }
    sumLines.push(line);
    sumChars += line.length;
  }
  // 最近 14 条聊天（多条消息回复后单轮对话占用行数变多，10 → 14 保持上下文覆盖最近 1~2 轮）
  const chats = await db.readingMemory.findMany({
    where: { bookUrl, kind: 'chat' },
    orderBy: { createdAt: 'desc' },
    take: 14,
  });
  chats.reverse();
  // 长期记忆：里程碑 + 其他书
  const milestones = await db.readingMemory.findMany({
    where: { kind: 'milestone' },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  const shelf = await db.shelfBook.findMany({ orderBy: [{ lastReadAt: 'desc' }], take: 12 });
  const otherBooks = shelf
    .filter((s) => s.bookUrl !== bookUrl)
    .slice(0, 6)
    .map((s) => `《${s.name}》${s.author ? `(${s.author})` : ''}读到${s.lastReadChapter + 1}/${s.totalChapters}章`);

  const bookCard = [
    `当前在读：《${book.name}》${book.author ? ` 作者：${book.author}` : ''}`,
    `进度：第 ${book.currentChapter + 1} 章（${book.currentChapterTitle}），全书共 ${book.totalChapters} 章，还剩 ${remain} 章看完`,
  ].join('\n');
  const plotBlock = sumLines.length
    ? `【全书剧情脉络（用户已读各章摘要，你已完整掌握）】\n${sumLines.join('\n')}`
    : '';
  const curBlock = curExcerpt
    ? `【当前章原文（第 ${book.currentChapter + 1} 章「${curTitle}」，节选）】\n${curExcerpt}`
    : '';

  const personaBlock = persona?.trim()
    ? `你的角色人设（你此刻以这个身份陪用户读书，全程保持一致口吻，不要跳出角色）：\n${persona.trim().slice(0, 900)}`
    : '你是「伴读书童」：博学温和、说话自然口语化，像一位一起追书的老友。';

  const sys: LLMMessage = {
    role: 'system',
    content: [
      '你是在手机「阅读App」里陪用户读小说的 AI 伴读。',
      personaBlock,
      memoryBlock?.trim()
        ? `【你对这段关系的长期记忆（来自记忆库，都是真实发生过的事）】\n${memoryBlock.trim().slice(0, 2200)}`
        : '',
      '【读书上下文】',
      bookCard,
      plotBlock,
      curBlock,
      otherBooks.length ? `【用户的其他在读书记录】\n${otherBooks.map((x) => `- ${x}`).join('\n')}` : '',
      milestones.length
        ? `【读书里程碑记忆】\n${milestones.map((m) => `- ${m.content}`).join('\n')}`
        : '',
      '【行为准则】',
      '- 你掌握当前章的完整原文和用户已读章节的全部摘要，聊剧情、人物、细节时优先依据这些内容回答。',
      '- 严禁剧透用户还没读到的章节（摘要与原文只包含已读部分）。',
      '- 你像真人一样连发消息：把这次回复拆成 3~10 条短消息（通常 4~6 条最自然），每条一句话左右，条与条之间用 ||| 分隔。',
      '- 拆法像真人发微信：第一条回应对方，后面自然展开（想法/吐槽/追问/感慨都可以），可以带表情符号或语气词，有长有短，最后一条可以留个小反问。',
      '- 每条消息内部不要换行、不要 markdown 标题或列表符号，单条不超过 60 字。',
      '- 用户问「讲到哪了/看到哪了」时，用进度信息回答。',
      '- 涉及未读章节或摘要之外的细节时，如实说记不清，不要编造。',
    ]
      .filter(Boolean)
      .join('\n'),
  };

  const history: LLMMessage[] = chats.map((c) => ({
    role: c.role === 'user' ? 'user' : 'assistant',
    content: c.content.slice(0, 800),
  }));
  return [sys, ...history];
}

/**
 * 模型回复容错拆分（多条消息）：
 * ① 优先按 ||| 分隔；② 不足 3 条时退回换行分隔；③ 仍不足时按句末标点切句；
 * ④ 单字符碎片并入前一条；⑤ 上限 10 条、单条 300 字，超出截断。
 */
export function splitAiReply(raw: string): string[] {
  const clean = (s: string) => s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  let parts = (raw || '')
    .split(/\|\|\|/)
    .map(clean)
    .filter(Boolean);
  if (parts.length < 3) {
    const byLine = (raw || '')
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
    if (byLine.length > parts.length) parts = byLine;
  }
  if (parts.length < 3) {
    const one = parts.join('') || (raw || '');
    const bySentence = one
      .split(/(?<=[。！？!?…～~；;])/)
      .map(clean)
      .filter(Boolean);
    if (bySentence.length > parts.length) parts = bySentence;
  }
  // 单字符碎片（孤立的标点/语气词）并入前一条，避免一条消息只有一个字
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length > 0 && p.length <= 1) merged[merged.length - 1] += p;
    else merged.push(p);
  }
  return merged.slice(0, 10).map((s) => s.slice(0, 300));
}

export async function companionChat(p: {
  bookUrl: string;
  book: ChatBookCtx;
  message: string;
  chapterUrl?: string;
  persona?: string;
  memoryBlock?: string;
}): Promise<string[]> {
  // 记住用户这条
  await db.readingMemory.create({
    data: { bookUrl: p.bookUrl, kind: 'chat', role: 'user', content: p.message.slice(0, 2000) },
  });
  const messages = await buildChatContext(p.bookUrl, p.book, p.chapterUrl, p.persona, p.memoryBlock);
  messages.push({ role: 'user', content: p.message.slice(0, 2000) });
  const raw = await lightChat(messages, 900);
  const replies = splitAiReply(raw || '');
  if (replies.length === 0) replies.push('（伴读书童走神了，再说一次嘛）');
  // 多条消息逐条落库（历史回放时天然就是多条气泡）
  for (const part of replies) {
    await db.readingMemory
      .create({ data: { bookUrl: p.bookUrl, kind: 'chat', role: 'assistant', content: part.slice(0, 2000) } })
      .catch(() => null);
  }
  // 记忆瘦身：本书聊天只留最近 150 条（多条回复后单轮占多行，60 → 150），摘要全留
  const count = await db.readingMemory.count({ where: { bookUrl: p.bookUrl, kind: 'chat' } });
  if (count > 150) {
    const olds = await db.readingMemory.findMany({
      where: { bookUrl: p.bookUrl, kind: 'chat' },
      orderBy: { createdAt: 'asc' },
      take: count - 150,
    });
    await db.readingMemory.deleteMany({ where: { id: { in: olds.map((o) => o.id) } } });
  }
  return replies;
}

/** 拉取某书的 AI 记忆（聊天记录 + 摘要时间线，供「我」页查看/管理） */
export async function getBookMemories(bookUrl: string, take = 50) {
  const rows = await db.readingMemory.findMany({
    where: { bookUrl },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    role: r.role,
    chapterIndex: r.chapterIndex,
    content: r.content,
    createdAt: r.createdAt,
  }));
}
