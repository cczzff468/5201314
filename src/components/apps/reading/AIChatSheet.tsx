'use client';

/**
 * AI 陪读（先选联系人 · 再聊天陪读）
 * ---------------------------------------------------------------------------
 * 流程：打开面板 → ① 选择陪读伙伴（联系人选择器，玻璃卡列表；内置「伴读书童」兜底）
 *      → ② 以该联系人的人设陪读聊天（知道书名/总章数/看到第几章/本章摘要/剩余章节）
 * 记忆双向打通（记在「记忆」App 里，与微信/QQ 共享）：
 * - 聊天前：memChatRecallBlock 召回该联系人的跨 App 记忆注入陪读上下文（TA 记得你们）
 * - 聊天后：memAddEventFragment 把每轮陪读对话写成记忆碎片（来源 App=阅读），
 *   记忆 App 里该联系人名下可查看/编辑/删除，互通开启时微信/QQ 聊天也能想起这些事
 * Token 省流：只注入章节摘要 + 最近对话 + 记忆召回块，正文永不进上下文。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Sparkles, Loader2, BookOpen, Users, RefreshCw, BrainCircuit, History, Zap, ChevronLeft } from 'lucide-react';
import { api, themeOf, type SourceItem } from './shared';
import { useReading } from '@/lib/reading/store';
import { listContacts, cachedOwnerName } from '@/lib/ios/contacts-store';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

/** 从联系人档案拼装陪读人设（客户端；服务端只收纯文本） */
function companionPersona(c: ContactRecord, ownerName: string): string {
  const name = c.nickname || c.name;
  const lines: string[] = [`你的名字：${name}${c.realName && c.realName !== name ? `（大名 ${c.realName}）` : ''}`];
  if (c.gender) lines.push(`性别：${c.gender}`);
  if (c.age) lines.push(`年龄：${c.age} 岁`);
  if (c.occupation) lines.push(`职业：${c.occupation}`);
  if (c.region) lines.push(`所在地：${c.region}`);
  if (c.relation) lines.push(`与${ownerName}的关系：${c.relation}`);
  if (c.persona) lines.push(`性格人设：${c.persona}`);
  if (c.expressStyle) lines.push(`表达风格：${c.expressStyle}`);
  if (c.background) lines.push(`背景故事：${c.background.slice(0, 300)}`);
  if (c.customRules) lines.push(`必须遵守的规矩（最高优先级）：\n${c.customRules.slice(0, 300)}`);
  return lines.join('\n');
}

const LAST_COMPANION_KEY = 'rd-last-companion';

export function AIChatSheet(props: {
  bookUrl: string;
  name: string;
  author: string;
  totalChapters: number;
  currentChapter: number;
  currentChapterTitle: string;
  summary: string;
  onClose: () => void;
  /** 打开即问（阅读器「查询」入口）：跳过选人直接发问 */
  initialAsk?: string;
  /** 当前章 URL（本章速读用） */
  chapterUrl?: string;
}) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [companion, setCompanion] = useState<ContactRecord | null>(null);
  /** pick=选择联系人阶段（每次打开先选人）；chat=陪读聊天阶段 */
  const [phase, setPhase] = useState<'pick' | 'chat'>('pick');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState(props.summary);
  const [cover, setCover] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const remain = Math.max(0, props.totalChapters - props.currentChapter - 1);
  const ownerName = useMemo(() => cachedOwnerName() || '我', []);

  // 联系人列表（排除机主本人与小号档案）+ 上次陪读伙伴
  const [lastCompanion, setLastCompanion] = useState<ContactRecord | null>(null);
  useEffect(() => {
    void listContacts().then((list) => {
      const ok = list.filter((c) => c.kind !== 'user' && !c.altOf);
      setContacts(ok);
      try {
        const id = localStorage.getItem(LAST_COMPANION_KEY);
        if (id) setLastCompanion(ok.find((c) => c.id === id) || null);
      } catch {
        /* 忽略 */
      }
    });
  }, []);

  // 拉历史聊天（同书）
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

  // 顺手抓一张本书真实封面（头部书卡用；有代理防防盗链）
  useEffect(() => {
    if (cover !== undefined || !sources.length) return;
    let alive = true;
    void (async () => {
      const enabled = sources.filter((s) => s.enabled).slice(0, 4);
      for (const src of enabled) {
        try {
          const r = await api.searchOne(props.name, src.id);
          const hit = (r.books || []).find((b) => b.coverUrl);
          if (hit?.coverUrl && alive) {
            setCover(`/api/reading/cover?u=${encodeURIComponent(hit.coverUrl)}&sid=${encodeURIComponent(hit.sourceId || src.id)}`);
            return;
          }
        } catch {
          /* 下一个源 */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.name]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, sending, companion]);

  // 打开即问（阅读器「查询」）：跳过选人阶段，直接以伴读书童身份发问
  useEffect(() => {
    if (!props.initialAsk) return;
    setPhase('chat');
    const t = setTimeout(() => void send(props.initialAsk), 80);
    return () => clearTimeout(t);
  }, []);

  const companionName = phase === 'chat' && companion ? displayNameOf(companion) : '伴读书童';

  const pick = (c: ContactRecord | null) => {
    setCompanion(c);
    setPhase('chat');
    try {
      localStorage.setItem(LAST_COMPANION_KEY, c ? c.id : '');
    } catch {
      /* 忽略 */
    }
  };

  // ---- AI 助读快捷：前情回顾 / 本章速读 ----
  const [aiBusy, setAiBusy] = useState<'recap' | 'digest' | null>(null);
  const [aiResult, setAiResult] = useState<{ kind: 'recap' | 'digest'; text: string } | null>(null);
  const runAi = async (kind: 'recap' | 'digest') => {
    if (aiBusy) return;
    setAiBusy(kind);
    try {
      const r = await fetch('/api/reading/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'recap'
            ? { action: 'recap', bookUrl: props.bookUrl, currentChapter: props.currentChapter, name: props.name }
            : { action: 'digest', chapterUrl: props.chapterUrl || '' },
        ),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      const text = kind === 'recap' ? r.recap : r.digest;
      setAiResult({ kind, text: text || (r.empty ? '' : '（生成失败，再试一次）') });
    } catch (e) {
      setAiResult({ kind, text: `（${e instanceof Error ? e.message : '生成失败，稍后再试'}）` });
    }
    setAiBusy(null);
  };

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: msg }]);
    setSending(true);
    // 记忆召回（记忆 App 里 TA 对这段关系的记忆）+ 人设
    const persona = companion ? companionPersona(companion, ownerName) : undefined;
    const memoryBlock = companion ? memChatRecallBlock(companion.id, 'reading', msg) : undefined;
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
        chapterUrl: props.chapterUrl || '',
        persona,
        memoryBlock,
      });
      // 多条消息回复（3~10 条）：优先 replies 数组；旧链路/异常退回 reply 按行拆
      let list: string[] = Array.isArray(r?.replies)
        ? r.replies.filter((x): x is string => typeof x === 'string' && !!x.trim())
        : [];
      if (!list.length) list = String(r?.reply || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
      if (!list.length) list.push('（伴读书童走神了，再说一次嘛）');
      // 像真人连发：逐条渐显，条间「正在输入」间隔（上一条越长等得越久 + 随机抖动）
      for (let i = 0; i < list.length; i++) {
        if (i > 0) {
          const wait = Math.min(2200, 480 + list[i - 1].length * 18 + Math.random() * 560);
          await new Promise((res) => setTimeout(res, wait));
        }
        setMsgs((m) => [...m, { role: 'assistant', content: list[i] }]);
      }
      // 写入记忆 App（来源=阅读；互通开启时微信/QQ 的 TA 也记得）
      if (companion) {
        memAddEventFragment(
          companion.id,
          'reading',
          `${companionName}在阅读App陪${ownerName}读《${props.name}》第${props.currentChapter + 1}章：${ownerName}说「${msg.slice(0, 60)}」，${companionName}连发${list.length}条消息回应：${list.join(' / ').slice(0, 120)}`,
          { eventTime: Date.now(), sourceTag: 'reading-companion' },
        );
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `（${e instanceof Error ? e.message : '伴读不在状态，再试一次'}）` }]);
    }
    setSending(false);
  };

  const quickAsks = ['现在讲到哪了？', '猜猜接下来的剧情', '聊聊主角', '这本书还剩多少章'];
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  // ------------------------------------------------------------------
  // 阶段①：选择陪读联系人（AI 助读快捷 + 玻璃卡列表）
  // ------------------------------------------------------------------
  const body = aiResult ? (
    /* AI 助读结果面板（前情回顾 / 本章速读） */
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAiResult(null)}
            aria-label="返回"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] active:scale-90"
          >
            <ChevronLeft className="h-4 w-4" style={{ color: theme.textMain }} />
          </button>
          <p className="flex items-center gap-1.5 text-[16px] font-bold" style={{ color: theme.textMain }}>
            {aiResult.kind === 'recap' ? <History className="h-[17px] w-[17px]" style={{ color: theme.accent }} /> : <Zap className="h-[17px] w-[17px]" style={{ color: theme.accent }} />}
            {aiResult.kind === 'recap' ? '前情回顾' : '本章速读'}
          </p>
          <button type="button" onClick={props.onClose} aria-label="关闭" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] active:scale-90">
            <X className="h-4 w-4" style={{ color: theme.textMain }} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
        <div className="rounded-2xl p-4 leading-relaxed ring-1 backdrop-blur-xl" style={glass}>
          <p className="whitespace-pre-wrap text-[14px]" style={{ color: theme.textMain }}>
            {aiResult.text ||
              (aiResult.kind === 'recap'
                ? '刚开书不久，还没有积累前情可回顾。先读几章，回头再来就能快速接上剧情啦。'
                : '本章还没缓存，先正常读一次本章后再来速读。')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runAi(aiResult.kind)}
          disabled={!!aiBusy}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-white active:scale-95 disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
        >
          {aiBusy === aiResult.kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          重新生成
        </button>
      </div>
    </div>
  ) : phase === 'pick' ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-[18px] w-[18px]" style={{ color: theme.accent }} />
            <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
              选择陪读伙伴
            </p>
          </div>
          <button type="button" onClick={props.onClose} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] active:scale-90">
            <X className="h-4 w-4" style={{ color: theme.textMain }} />
          </button>
        </div>
        {/* 书籍上下文迷你卡 */}
        <div className="mt-2.5 flex items-center gap-3 rounded-2xl p-3 ring-1 backdrop-blur-xl" style={glass}>
          {cover ? (
            <img src={cover} alt="" className="h-11 w-8 shrink-0 rounded-md object-cover ring-1 ring-black/5" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-11 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: theme.accentSoft }}>
              <BookOpen className="h-4 w-4" style={{ color: theme.accent }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
              《{props.name}》
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
              第 {props.currentChapter + 1}/{props.totalChapters} 章 · {remain > 0 ? `还剩 ${remain} 章` : '已读最新章'}
            </p>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1 px-1 text-[11px]" style={{ color: theme.textSub }}>
          <BrainCircuit className="h-3.5 w-3.5" />
          TA 会以自己的人设陪你读这本书，聊天记入「记忆」App
        </p>
        {/* AI 助读快捷：前情回顾 / 本章速读（一键生成，无需选人） */}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void runAi('recap')}
            disabled={!!aiBusy}
            className="flex flex-col items-start gap-1.5 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.97] disabled:opacity-60"
            style={glass}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: theme.accentSoft, color: theme.accent }}>
              {aiBusy === 'recap' ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-[17px] w-[17px]" />}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: theme.textMain }}>
              前情回顾
            </span>
            <span className="text-[10px] leading-tight" style={{ color: theme.textSub }}>
              上次看到哪了，快速接上剧情
            </span>
          </button>
          <button
            type="button"
            onClick={() => void runAi('digest')}
            disabled={!!aiBusy || !props.chapterUrl}
            className="flex flex-col items-start gap-1.5 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.97] disabled:opacity-60"
            style={glass}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: theme.accentSoft, color: theme.accent }}>
              {aiBusy === 'digest' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-[17px] w-[17px]" />}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: theme.textMain }}>
              本章速读
            </span>
            <span className="text-[10px] leading-tight" style={{ color: theme.textSub }}>
              3~5 条要点，一分钟看完本章
            </span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {/* 上次陪读伙伴：一键继续 */}
        {lastCompanion && (
          <button
            type="button"
            onClick={() => pick(lastCompanion)}
            className="mb-3 flex w-full items-center gap-3 rounded-2xl p-3 text-left text-white shadow-lg active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 8px 24px ${theme.accent}44` }}
          >
            {lastCompanion.avatar ? (
              <img src={lastCompanion.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white/50" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/25 text-[15px] font-semibold ring-2 ring-white/40">
                {displayNameOf(lastCompanion).slice(0, 1)}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-white/85">上次陪你读书的 TA</span>
              <span className="block truncate text-[15px] font-bold">继续和 {displayNameOf(lastCompanion)} 陪读</span>
            </span>
            <Sparkles className="h-4 w-4 shrink-0 text-white/80" />
          </button>
        )}
        {/* 内置伴读书童 */}
        <button
          type="button"
          onClick={() => pick(null)}
          className="mb-2 flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.98]"
          style={glass}
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff' }}>
            <Sparkles className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold" style={{ color: theme.textMain }}>
              伴读书童
            </span>
            <span className="mt-0.5 block truncate text-[12px]" style={{ color: theme.textSub }}>
              内置角色 · 博学温和，随叫随到的读书老友
            </span>
          </span>
        </button>
        <p className="mb-2 px-1 text-[11px] font-medium" style={{ color: theme.textSub }}>
          或从联系人里挑一位（按 TA 的人设陪读）
        </p>
        {contacts.length === 0 && (
          <p className="py-6 text-center text-[12px]" style={{ color: theme.textSub }}>
            还没有联系人，先用内置「伴读书童」吧
          </p>
        )}
        {contacts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c)}
            className="mb-2 flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.98]"
            style={glass}
          >
            {c.avatar ? (
              <img src={c.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
                {displayNameOf(c).slice(0, 1)}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
                {displayNameOf(c)}
                {c.kind === 'npc' && (
                  <span className="ml-1.5 rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                    配角
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[12px]" style={{ color: theme.textSub }}>
                {c.persona || c.relation || c.occupation || '点 TA 陪你看书'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : (
    // ------------------------------------------------------------------
    // 阶段②：陪读聊天
    // ------------------------------------------------------------------
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          {companion?.avatar ? (
            <img src={companion.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
          ) : (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold"
              style={
                companion
                  ? { background: theme.accentSoft, color: theme.accent }
                  : { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff' }
              }
            >
              {companionName.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[15px] font-bold" style={{ color: theme.textMain }}>
              {companionName}
              <span className="rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                AI 陪读
              </span>
            </p>
            <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
              《{props.name}》第 {props.currentChapter + 1} 章 · 还剩 {remain} 章
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPhase('pick')}
            aria-label="换个陪读"
            className="flex h-9 w-9 items-center justify-center rounded-full ring-1 backdrop-blur-xl active:scale-90"
            style={{ ...glass, color: theme.textMain }}
          >
            <Users className="h-4 w-4" />
          </button>
          <button type="button" onClick={props.onClose} aria-label="关闭" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.05] active:scale-90">
            <X className="h-4 w-4" style={{ color: theme.textMain }} />
          </button>
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
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff' }}
            >
              <Sparkles className="h-6 w-6" />
            </span>
            <p className="text-[14px] font-semibold" style={{ color: theme.textMain }}>
              {companionName} 陪你读《{props.name}》
            </p>
            <p className="px-6 text-[12px] leading-relaxed" style={{ color: theme.textSub }}>
              TA 知道你看到第 {props.currentChapter + 1} 章、还剩 {remain} 章，也记得本章剧情。聊聊讲到哪了、猜猜走向都行。
            </p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex items-end gap-1.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
                {companionName.slice(0, 1)}
              </span>
            )}
            <div
              className={`max-w-[76%] px-3.5 py-2.5 text-[14px] leading-relaxed ${m.role === 'user' ? 'rounded-2xl rounded-br-md text-white' : 'rounded-2xl rounded-bl-md ring-1 backdrop-blur-xl'}`}
              style={
                m.role === 'user'
                  ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 4px 14px ${theme.accent}33` }
                  : { background: theme.cardBg, color: theme.textMain, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing }
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-end gap-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
              {companionName.slice(0, 1)}
            </span>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md px-4 py-3 ring-1 backdrop-blur-xl" style={glass}>
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
            </div>
          </div>
        )}
      </div>

      {/* 快捷提问（iOS 式单行横滑，无滚动条） */}
      {msgs.length === 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar">
          {quickAsks.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-medium ring-1 backdrop-blur-xl active:scale-95"
              style={{ background: theme.cardBg, color: theme.accent, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* 输入条 */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-1">
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-full px-4 ring-1 backdrop-blur-xl" style={glass}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            placeholder={`和 ${companionName} 聊聊这本书…`}
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
          style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
        >
          <Send className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );

  void sources;

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-label="AI 陪读">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={props.onClose} />
      <div
        className="absolute inset-x-0 bottom-0 flex h-[84%] flex-col rounded-t-3xl shadow-2xl backdrop-blur-2xl"
        style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
      >
        {/* 顶部抓手条 */}
        <div className="flex shrink-0 justify-center pb-1 pt-2.5">
          <span className="h-1 w-10 rounded-full" style={{ background: 'rgba(0,0,0,0.12)' }} />
        </div>
        {body}
      </div>
    </div>
  );
}
