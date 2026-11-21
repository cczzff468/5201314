/**
 * 阅读 App · AI 陪读服务层（仅服务端）
 * ---------------------------------------------------------------------------
 * Token 危机解法（用户需求原话：一章两三千字，每次聊天都发三千字，额度几轮就烧光）：
 * 1. 翻章时后台静默调用小模型把本章压成 ~100 字剧情摘要（genChapterSummary）
 * 2. 聊天时只注入：当前书信息卡（书名/总章数/进度/剩余）+ 最近 3 章摘要 + 最近 10 条
 *    对话 + 长期记忆（历史读书里程碑 + 书架在读列表），正文本身永不进上下文
 * 3. 所有对话/摘要/里程碑写 ReadingMemory（=「看过什么书、书的内容、聊过的天」全记忆）
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

/** 轻量补全（禁思考链，省 Token） */
async function lightChat(messages: LLMMessage[], maxTokens = 512): Promise<string> {
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

/** 拼装陪读上下文（全部走摘要，不塞正文） */
async function buildChatContext(bookUrl: string, book: ChatBookCtx, persona?: string): Promise<LLMMessage[]> {
  const remain = Math.max(0, book.totalChapters - book.currentChapter - 1);
  // 最近 3 章摘要（当前章 + 前两章）
  const summaries = await db.readingMemory.findMany({
    where: { bookUrl, kind: 'summary' },
    orderBy: { chapterIndex: 'desc' },
    take: 8,
  });
  const recentSum = summaries
    .filter((s) => s.chapterIndex !== null && s.chapterIndex <= book.currentChapter)
    .slice(0, 3)
    .reverse();
  // 最近 10 条聊天
  const chats = await db.readingMemory.findMany({
    where: { bookUrl, kind: 'chat' },
    orderBy: { createdAt: 'desc' },
    take: 10,
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
    recentSum.length
      ? `最近剧情（摘要，按时间序）：\n${recentSum.map((s) => `- 第${(s.chapterIndex ?? 0) + 1}章：${s.content}`).join('\n')}`
      : '最近剧情摘要：暂无',
  ].join('\n');

  const personaBlock = persona?.trim()
    ? `你的角色人设（与手机里的 AI 助手同一人设，保持一致口吻）：\n${persona.trim().slice(0, 600)}`
    : '你是「伴读书童」：博学温和、说话自然口语化，像一位一起追书的老友。';

  const sys: LLMMessage = {
    role: 'system',
    content: [
      '你是在手机「阅读App」里陪用户读小说的 AI 伴读。',
      personaBlock,
      '【读书上下文】',
      bookCard,
      otherBooks.length ? `【用户的其他在读书记录】\n${otherBooks.map((x) => `- ${x}`).join('\n')}` : '',
      milestones.length
        ? `【读书里程碑记忆】\n${milestones.map((m) => `- ${m.content}`).join('\n')}`
        : '',
      '【行为准则】',
      '- 聊天围绕当前这本书的剧情、人物、猜测展开，也可以闲聊，但记得把话题往阅读上带。',
      '- 严禁剧透用户还没读到的章节（只基于「最近剧情摘要」及更早内容回答）。',
      '- 回答简短自然（通常 2~4 句），像微信聊天，不要长篇大论，不要输出 markdown 标题。',
      '- 用户问「讲到哪了/看到哪了」时，用进度信息回答。',
      '- 涉及章节原文细节且摘要没有时，如实说记不清细节，不要编造。',
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

export async function companionChat(p: {
  bookUrl: string;
  book: ChatBookCtx;
  message: string;
  persona?: string;
}): Promise<string> {
  // 记住用户这条
  await db.readingMemory.create({
    data: { bookUrl: p.bookUrl, kind: 'chat', role: 'user', content: p.message.slice(0, 2000) },
  });
  const messages = await buildChatContext(p.bookUrl, p.book, p.persona);
  messages.push({ role: 'user', content: p.message.slice(0, 2000) });
  const reply = (await lightChat(messages, 700)) || '（伴读书童走神了，再说一次嘛）';
  await db.readingMemory.create({
    data: { bookUrl: p.bookUrl, kind: 'chat', role: 'assistant', content: reply.slice(0, 2000) },
  });
  // 记忆瘦身：本书聊天只留最近 60 条，摘要全留
  const count = await db.readingMemory.count({ where: { bookUrl: p.bookUrl, kind: 'chat' } });
  if (count > 60) {
    const olds = await db.readingMemory.findMany({
      where: { bookUrl: p.bookUrl, kind: 'chat' },
      orderBy: { createdAt: 'asc' },
      take: count - 60,
    });
    await db.readingMemory.deleteMany({ where: { id: { in: olds.map((o) => o.id) } } });
  }
  return reply;
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
