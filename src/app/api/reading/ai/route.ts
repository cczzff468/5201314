import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { lightChat } from '@/lib/reading/ai-light';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * AI 助读三件套：
 * - { action:'recap', bookUrl, currentChapter, name }   前情回顾（上次看到…，基于已读章节摘要生成）
 * - { action:'digest', chapterUrl }                     本章速读（当前章 3~5 条要点 + 一句话看点）
 * - { action:'booklist' }                               AI 推荐书单（基于书架 + 阅读历史生成 8~10 本）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || '');

  try {
    // ------------------------------------------------------------------
    // 前情回顾：已读章节的摘要（ReadingMemory）→ 压缩成连贯的「上次看到…」
    // ------------------------------------------------------------------
    if (action === 'recap') {
      const bookUrl = String(body.bookUrl || '');
      const currentChapter = Number(body.currentChapter || 0);
      const name = String(body.name || '这本书');
      if (!bookUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
      const sums = await db.readingMemory.findMany({
        where: { bookUrl, kind: 'summary', chapterIndex: { not: null } },
        orderBy: { chapterIndex: 'asc' },
      });
      const read = sums.filter((s) => (s.chapterIndex ?? 0) < currentChapter).slice(-8);
      if (!read.length) {
        return NextResponse.json({ recap: '', empty: true });
      }
      const from = (read[0].chapterIndex ?? 0) + 1;
      const to = (read[read.length - 1].chapterIndex ?? 0) + 1;
      const recap = await lightChat(
        [
          {
            role: 'system',
            content:
              '你是小说前情回顾器。读者刚打开《' + name + '》，正要读第 ' + (currentChapter + 1) + ' 章。把下面这些已读章节的剧情摘要串成一段连贯的「前情回顾」，帮助 TA 快速接上剧情：交代主要人物、关键事件走向、留下的悬念。250 字以内，直接输出回顾正文，不要标题和解释，口吻像贴心书友的自然讲述。',
          },
          {
            role: 'user',
            content: `第${from}章 ~ 第${to}章 的剧情摘要（按时间序）：\n${read
              .map((s) => `- 第${(s.chapterIndex ?? 0) + 1}章：${s.content}`)
              .join('\n')}`,
          },
        ],
        420,
      );
      return NextResponse.json({ recap: recap || '（回顾生成失败，再试一次）', range: `第${from}~${to}章` });
    }

    // ------------------------------------------------------------------
    // 本章速读：当前章正文（ChapterCache）→ 3~5 条要点 + 一句话看点
    // ------------------------------------------------------------------
    if (action === 'digest') {
      const chapterUrl = String(body.chapterUrl || '');
      if (!chapterUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
      const cached = await db.chapterCache.findUnique({ where: { chapterUrl } });
      if (!cached?.content) return NextResponse.json({ digest: '', empty: true });
      const digest = await lightChat(
        [
          {
            role: 'system',
            content:
              '你是小说章节速读器。把用户给的章节内容压缩成速读卡：先用一句话点出本章看点，再列 3~5 条剧情要点（每条一句话）。总长 200 字以内。直接输出，格式：\n看点：…\n· 要点一\n· 要点二\n…',
          },
          { role: 'user', content: `【${cached.title || '本章'}】\n${cached.content.slice(0, 3600)}` },
        ],
        360,
      );
      return NextResponse.json({ digest: digest || '（速读生成失败，再试一次）' });
    }

    // ------------------------------------------------------------------
    // AI 推荐书单：书架 + 阅读历史 → 生成 8~10 本推荐（附理由）
    // ------------------------------------------------------------------
    if (action === 'booklist') {
      const shelf = await db.shelfBook.findMany({ orderBy: [{ lastReadAt: 'desc' }], take: 20 });
      const reads = await db.readHistory.findMany({ orderBy: [{ lastReadAt: 'desc' }], take: 20 });
      const seen = new Set<string>();
      const lib = [
        ...shelf.map((b) => ({ name: b.name, author: b.author, tag: '在架' })),
        ...reads.map((b) => ({ name: b.name, author: b.author, tag: '读过' })),
      ].filter((b) => {
        const k = b.name.trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!lib.length) return NextResponse.json({ list: [], empty: true });
      const text = await lightChat(
        [
          {
            role: 'system',
            content:
              '你是资深书友。根据用户的书架和阅读历史，推荐 8 本 TA 可能会喜欢的小说（可以推荐任何真实存在的知名小说，尽量贴合 TA 的口味，类型多样一点）。严格输出 JSON 数组，不要 markdown 代码块：[{"name":"书名","author":"作者","reason":"一句话推荐理由（20字内，点明为什么适合TA）","tag":"分类"}]',
          },
          {
            role: 'user',
            content: `用户的书（书名 | 作者 | 分类/状态）：\n${lib
              .map((b) => `- 《${b.name}》${b.author ? ` | ${b.author}` : ''} | ${b.tag}`)
              .join('\n')}`,
          },
        ],
        900,
      );
      // 宽松 JSON 解析（模型可能带 ```json 包裹）
      const m = /\[[\s\S]*\]/.exec(text);
      let list: { name: string; author?: string; reason?: string; tag?: string }[] = [];
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as unknown;
          if (Array.isArray(parsed)) {
            list = parsed
              .filter((x) => x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string')
              .slice(0, 10)
              .map((x) => {
                const o = x as Record<string, unknown>;
                return {
                  name: String(o.name).slice(0, 40),
                  author: typeof o.author === 'string' ? o.author.slice(0, 30) : '',
                  reason: typeof o.reason === 'string' ? o.reason.slice(0, 60) : '',
                  tag: typeof o.tag === 'string' ? o.tag.slice(0, 12) : '',
                };
              });
          }
        } catch {
          /* 解析失败走兜底 */
        }
      }
      if (!list.length) return NextResponse.json({ list: [], empty: true });
      return NextResponse.json({ list });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : 'AI 助读失败' }, { status: 500 });
  }
}
