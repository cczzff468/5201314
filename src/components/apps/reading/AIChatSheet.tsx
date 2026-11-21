'use client';

/**
 * AI 伴读聊天面板（底部抽屉）
 * - 顶部书籍上下文卡：书名/进度/剩余章节（AI 全都知道）
 * - 章节摘要展示（后台已静默生成，聊天的剧情依据）
 * - 聊天气泡（含历史）+ 快捷提问（讲到哪了/猜剧情/人物关系/聊聊天）
 * - 上下文策略见 /api/reading/chat：只注入摘要+最近对话，正文永不进上下文（省 Token）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Sparkles, Loader2, BookOpen } from 'lucide-react';
import { api, themeOf } from './shared';
import { useReading } from '@/lib/reading/store';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function AIChatSheet(props: {
  bookUrl: string;
  name: string;
  author: string;
  totalChapters: number;
  currentChapter: number;
  currentChapterTitle: string;
  summary: string;
  onClose: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState(props.summary);
  const scrollRef = useRef<HTMLDivElement>(null);
  const remain = Math.max(0, props.totalChapters - props.currentChapter - 1);

  // 拉历史聊天
  useEffect(() => {
    api
      .history(props.bookUrl)
      .then((d) => {
        const memories = (d.memories || []) as { kind: string; role?: string; content: string }[];
        const chats = memories
          .filter((m) => m.kind === 'chat')
          .reverse()
          .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }) as Msg)
          .slice(-30);
        setMsgs(chats);
      })
      .catch(() => null);
  }, [props.bookUrl]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, sending]);

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: msg }]);
    setSending(true);
    try {
      const r = await api.chat({
        bookUrl: props.bookUrl,
        book: {
          name: props.name,
          author: props.author,
          currentChapter: props.currentChapter,
          currentChapterTitle: props.currentChapterTitle,
          totalChapters: props.totalChapters,
        },
        message: msg,
      });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `（${e instanceof Error ? e.message : '伴读不在状态，再试一次'}）` }]);
    }
    setSending(false);
  };

  const quickAsks = ['现在讲到哪了？', '猜猜接下来的剧情', '聊聊主角', '这本书还剩多少章'];

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-label="AI 伴读">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={props.onClose} />
      <div className="absolute inset-x-0 bottom-0 flex h-[82%] flex-col rounded-t-3xl shadow-2xl" style={{ background: theme.pageBg }}>
        {/* 头部 + 书籍上下文卡 */}
        <div className="shrink-0 px-5 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-[18px] w-[18px]" style={{ color: theme.accent }} />
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                AI 伴读
              </p>
            </div>
            <button type="button" onClick={props.onClose} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] active:scale-90">
              <X className="h-4 w-4" style={{ color: theme.textMain }} />
            </button>
          </div>
          <div
            className="mt-2.5 flex items-center gap-3 rounded-2xl p-3 ring-1 backdrop-blur-xl"
            style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: theme.accentSoft, color: theme.accent }}>
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                《{props.name}》
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
                第 {props.currentChapter + 1}/{props.totalChapters} 章 · {remain > 0 ? `还剩 ${remain} 章看完` : '已读完最新章'}
              </p>
            </div>
          </div>
          {summary && (
            <p className="mt-2 line-clamp-2 rounded-xl bg-black/[0.03] px-3 py-2 text-[11px] leading-relaxed" style={{ color: theme.textSub }}>
              本章摘要：{summary}
            </p>
          )}
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3">
          {msgs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: theme.accentSoft, color: theme.accent }}>
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-[14px] font-semibold" style={{ color: theme.textMain }}>
                我在读的这本，AI 都记得
              </p>
              <p className="px-6 text-[12px] leading-relaxed" style={{ color: theme.textSub }}>
                书名、进度、每章剧情摘要和我们的聊天都会记入记忆。问我讲到哪了、聊聊剧情、猜猜走向都行。
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${m.role === 'user' ? 'rounded-br-md text-white' : 'rounded-bl-md'}`}
                style={
                  m.role === 'user'
                    ? { background: theme.accent }
                    : { background: theme.cardBg, color: theme.textMain, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)' }
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md px-4 py-3" style={{ background: theme.cardBg }}>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
              </div>
            </div>
          )}
        </div>

        {/* 快捷提问 */}
        {msgs.length === 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quickAsks.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                className="h-8 shrink-0 rounded-full px-3.5 text-[12px] font-medium ring-1 backdrop-blur-xl active:scale-95"
                style={{ background: theme.cardBg, color: theme.accent, ['--tw-ring-color' as string]: theme.cardRing }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* 输入条 */}
        <div className="flex shrink-0 items-center gap-2 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-1">
          <div
            className="flex h-11 min-w-0 flex-1 items-center rounded-full px-4 ring-1 backdrop-blur-xl"
            style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="和 AI 聊聊这本书…"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              style={{ color: theme.textMain }}
              aria-label="聊天输入"
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            aria-label="发送"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-all active:scale-90 disabled:opacity-40"
            style={{ background: theme.accent }}
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
