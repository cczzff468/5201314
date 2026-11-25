'use client';

/**
 * AI 专属分屏浏览器 —— 可移动小窗（第三十轮：固定底部半屏改小窗，机主需求「让它变成小窗，可以移动」）。
 *
 * 形态：
 * - 圆角 22px 浮窗（宽 78% × 高 46%，默认贴右下、可拖到任意位置），标题条拖拽换位
 *   （setPointerCapture + 归一化位置 localStorage 持久化，与聊天悬浮窗同款范式）；
 * - 上半屏聊天/任何 App 照常可用（根层 pointer-events-none 不挡下层，窗口本体 auto）；
 * - 工具栏：后退 + 地址/搜索输入 + 引擎选择（百度主用/360/淘宝/搜狗/抖音/快手）+ 网页↔阅读
 *   模式切换 + 关闭；
 * - 网页模式：iframe 直接加载（6s 慢加载检测 → 逃生条「切阅读模式/新窗口打开」）；
 * - 阅读模式：服务端 /api/web-tools/read 抽取纯正文（Jina Reader 风格），AI 的
 *   highlightWebText 工具在阅读模式点亮文本并滚动到位；
 * - 悬浮球/网页卡片/AI 工具唤起后点开即显示【上次看的页面】（store 持久化恢复）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronDown, Globe, Loader2, Search, X } from 'lucide-react';
import { useAIBrowser, SEARCH_ENGINES, type AIBrowserPage, type SearchEngineId } from '@/lib/ios/ai-browser-store';

/** 小窗尺寸（占壳比例） */
const WIN_W = 0.78;
const WIN_H = 0.46;
/** 拖拽把手热区（标题条） */
const GRAB_H = 40;

/** URL/搜索词归一：带协议的当网址，其余当搜索词（走当前引擎，百度主用） */
function normalizeInput(raw: string): { url?: string; query?: string } {
  const t = raw.trim();
  if (!t) return {};
  if (/^https?:\/\//i.test(t)) return { url: t };
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && t.includes('.')) return { url: `https://${t}` };
  return { query: t };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

/** 阅读模式段落（带高亮命中标记） */
function ReaderParagraphs({ text, highlight }: { text: string; highlight: { text: string; seq: number } | null }) {
  const paras = useMemo(() => text.split('\n').filter((p) => p.trim()), [text]);
  const highlightRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!highlight?.text || paras.length === 0) return;
    const idx = paras.findIndex((p) => p.includes(highlight.text));
    if (idx < 0) return;
    highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (paras.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-black/30 dark:text-white/30">这个网页没有可读的正文</p>;
  }

  return (
    <div className="px-4 pb-6 pt-1">
      {paras.map((p, i) => {
        const hit = Boolean(highlight?.text && p.includes(highlight.text));
        return (
          <p
            key={i}
            ref={hit ? (el) => { highlightRef.current = el; } : undefined}
            className={`mb-3 text-[14px] leading-[1.75] ${
              hit
                ? 'rounded-[8px] bg-[#FFD60A]/45 px-1.5 py-1 font-medium text-black shadow-[0_1px_4px_rgba(250,204,21,0.4)] ring-1 ring-[#FF9F0A]/50 dark:text-black'
                : 'text-black/80 dark:text-white/75'
            }`}
          >
            {p}
          </p>
        );
      })}
    </div>
  );
}

export default function AIBrowserWindow() {
  const {
    open, origin, mode, page, engine, enginePickerOpen, highlight, reading, winPos,
    openPanel, closePanel, setMode, setEngine, setEnginePicker, setPage, setLoading, clearHighlight, goBack, setWinPos,
  } = useAIBrowser();
  const historyLen = useAIBrowser((s) => s.history.length);
  const [input, setInput] = useState('');
  const [shown, setShown] = useState(false); // 入场动画态
  const [readerPage, setReaderPage] = useState<AIBrowserPage | null>(null); // 阅读模式数据
  const [iframeSlow, setIframeSlow] = useState(false); // iframe 加载缓慢/被拒嵌提示
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ px: number; py: number; wx: number; wy: number } | null>(null);
  const inputFocus = useRef(false);
  const winRef = useRef<HTMLDivElement | null>(null);

  // 打开时同步地址栏 + 入场动画 + 慢加载检测复位；重置阅读 loading（跨热重载/重开的脏态）
  useEffect(() => {
    if (open) {
      setShown(true);
      setInput(page?.url ?? '');
      setIframeSlow(false);
      setLoading(false); // 开窗口即清 stale loading（zustand 模块态跨热重载/重开存留，不重置会永久卡「提取中」）
      const t = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    setInput('');
    setReaderPage(null);
    setIframeSlow(false);
  }, [open, page?.url, setLoading]);

  // 阅读模式：拉取正文（/api/web-tools/read）
  useEffect(() => {
    if (!open || mode !== 'reader' || !page?.url) return;
    if (readerPage?.url === page.url && readerPage.text) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/web-tools/read?url=${encodeURIComponent(page.url)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { ok: boolean; page?: { url: string; title: string; desc: string; favicon: string; text: string; truncated: boolean } }) => {
        if (!alive || !data.ok || !data.page) return;
        const p: AIBrowserPage = { ...data.page, readAt: Date.now() };
        setReaderPage(p);
        setPage(p); // 回写 store（AI 感知注入 + 悬浮球「上次看的页面」记忆用）
      })
      .catch(() => undefined)
      .finally(() => {
        // 无条件收起 loading：setPage 回写会把 URL 规范化（补斜杠）触发本 effect 重跑，
        // 旧闭包 alive 已被置 false——若按 alive 跳过会永远卡在「正在提取正文」
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, mode, page?.url, readerPage?.url, readerPage?.text, setLoading, setPage]);

  // 模式切换离开阅读模式时清高亮 + 关引擎弹层
  useEffect(() => {
    if (mode !== 'reader') clearHighlight();
  }, [mode, clearHighlight]);
  useEffect(() => {
    if (!open) setEnginePicker(false);
  }, [open, setEnginePicker]);

  // 网页模式慢加载检测（6s 仍无 onLoad → 弹逃生条：X-Frame-Options 拒嵌的可能）
  useEffect(() => {
    if (!open || mode !== 'web' || !page?.url) return;
    setIframeSlow(false);
    const timer = window.setTimeout(() => setIframeSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [open, mode, page?.url]);

  /* ---------------- 标题条拖拽（小窗移动） ---------------- */

  const onGrabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!winRef.current) return;
    const shell = (e.currentTarget.closest('[data-phone-shell]') as HTMLElement | null) ?? document.body;
    const rect = winRef.current.getBoundingClientRect();
    const sRect = shell.getBoundingClientRect();
    const nx = (rect.x - sRect.x) / sRect.width;
    const ny = (rect.y - sRect.y) / sRect.height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, wx: nx, wy: ny };
    setDragging(true);
  };

  const onGrabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !winRef.current) return;
    const shell = (e.currentTarget.closest('[data-phone-shell]') as HTMLElement | null) ?? document.body;
    const sRect = shell.getBoundingClientRect();
    const dx = (e.clientX - dragStart.current.px) / sRect.width;
    const dy = (e.clientY - dragStart.current.py) / sRect.height;
    // 归一化位置（窗口左上角），clamp 留 6px 边界（窗口至少露 40px 在屏内）
    const ww = WIN_W;
    const wh = WIN_H;
    const x = Math.min(Math.max(dragStart.current.wx + dx, 0.02 - 0), 1 - ww * 0.35);
    const y = Math.min(Math.max(dragStart.current.wy + dy, 0.02), 1 - 0.12);
    setWinPos({ x: Math.max(x, -ww + 0.4), y });
  };

  const onGrabPointerUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  if (!open) return null;

  const displayUrl = page?.url ?? '';
  const engineName = SEARCH_ENGINES.find((e) => e.id === engine)?.name ?? '百度';
  // 默认位置：右下（露出 Home 指示条）
  const posStyle: React.CSSProperties = winPos
    ? { left: `${winPos.x * 100}%`, top: `${winPos.y * 100}%` }
    : { right: '3%', bottom: '7%' };

  return (
    <div className="pointer-events-none absolute inset-0 z-[59]" data-testid="ai-browser-sheet" role="dialog" aria-label="AI 浏览器小窗">
      {/* 小窗本体：浮层圆角卡（入场缩放淡入 + 拖拽时去掉过渡） */}
      <div
        ref={winRef}
        className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-[22px] border border-black/10 bg-[#F5F5F7] shadow-[0_18px_50px_rgba(0,0,0,0.34)] ring-1 ring-black/[0.06] transition-[opacity,transform] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] dark:border-white/15 dark:bg-[#1C1C1E] dark:ring-white/10 ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0'
        } ${dragging ? 'transition-none' : ''}`}
        style={{ width: `${WIN_W * 100}%`, height: `${WIN_H * 100}%`, ...posStyle }}
      >
        {/* 标题条（拖拽把手）+ 工具栏 */}
        <div className="shrink-0 border-b border-black/[0.07] bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#2A2A2C]/95">
          {/* 抓手条：整条可拖动换位（触摸/鼠标皆可） */}
          <div
            className="flex h-[26px] cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing"
            onPointerDown={onGrabPointerDown}
            onPointerMove={onGrabPointerMove}
            onPointerUp={onGrabPointerUp}
            onPointerCancel={onGrabPointerUp}
            aria-label="拖动移动浏览器小窗"
            role="button"
            tabIndex={-1}
          >
            <span className="h-[5px] w-[38px] rounded-full bg-black/15 transition dark:bg-white/20" />
          </div>
          {/* 工具栏：后退 + 地址/搜索 + 引擎 + 模式 + 关闭 */}
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <button
              type="button"
              aria-label="后退"
              disabled={!page || !page.url || historyLen < 2}
              onClick={() => {
                const back = goBack();
                if (back) setInput(back);
              }}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/60 transition active:scale-90 disabled:opacity-30 dark:bg-white/10 dark:text-white/60"
            >
              <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
            </button>
            {/* 地址/搜索输入框 */}
            <form
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 py-[6px] ring-1 ring-black/[0.04] transition focus-within:bg-white focus-within:ring-[#007AFF]/40 dark:bg-white/10 dark:ring-white/[0.06] dark:focus-within:bg-black/50"
              onSubmit={(e) => {
                e.preventDefault();
                const { url, query } = normalizeInput(input);
                if (!url && !query) return;
                openPanel({ ...(url ? { url } : { query }), origin: 'user' });
              }}
            >
              {mode === 'reader' ? (
                <BookOpen className="h-[13px] w-[13px] shrink-0 text-[#007AFF]" strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Globe className="h-[13px] w-[13px] shrink-0 text-black/40 dark:text-white/40" strokeWidth={2.2} aria-hidden="true" />
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  inputFocus.current = true;
                }}
                onBlur={() => {
                  inputFocus.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                    const { url, query } = normalizeInput(input);
                    if (url || query) openPanel({ ...(url ? { url } : { query }), origin: 'user' });
                  }
                }}
                placeholder={`搜一下或输入网址（${engineName}）`}
                aria-label="地址栏：搜索或输入网址"
                enterKeyHint="go"
                className="min-w-0 flex-1 bg-transparent text-[13px] leading-none text-black/85 outline-none placeholder:text-black/30 dark:text-white/85 dark:placeholder:text-white/30"
              />
            </form>
            {/* 引擎选择（百度主用；点击弹小菜单切 360/淘宝/搜狗/抖音/快手） */}
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label={`搜索引擎：${engineName}，点击切换`}
                aria-expanded={enginePickerOpen}
                data-testid="ai-browser-engine"
                onClick={() => setEnginePicker(!enginePickerOpen)}
                className="flex h-[30px] items-center gap-[3px] rounded-full bg-black/[0.05] px-2.5 text-[12px] font-medium text-black/65 transition active:scale-95 dark:bg-white/10 dark:text-white/65"
              >
                {engineName}
                <ChevronDown className="h-[12px] w-[12px]" strokeWidth={2.4} aria-hidden="true" />
              </button>
              {enginePickerOpen ? (
                <div className="absolute right-0 top-[34px] z-[3] w-[104px] overflow-hidden rounded-[14px] bg-white/95 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.08] backdrop-blur-xl dark:bg-[#2A2A2C]/95 dark:ring-white/10">
                  {SEARCH_ENGINES.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={engine === e.id}
                      data-testid={`ai-engine-${e.id}`}
                      onClick={() => setEngine(e.id as SearchEngineId)}
                      className={`flex w-full items-center justify-between px-3 py-[7px] text-left text-[13px] transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                        engine === e.id ? 'font-semibold text-[#007AFF]' : 'text-black/75 dark:text-white/75'
                      }`}
                    >
                      {e.name}
                      {engine === e.id ? <span className="h-[6px] w-[6px] rounded-full bg-[#007AFF]" aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {/* 模式切换：网页 ↔ 阅读 */}
            <button
              type="button"
              role="switch"
              aria-checked={mode === 'reader'}
              aria-label={mode === 'reader' ? '切换到网页模式' : '切换到阅读模式'}
              title={mode === 'reader' ? '网页模式' : '阅读模式（纯正文，可高亮）'}
              onClick={() => setMode(mode === 'reader' ? 'web' : 'reader')}
              className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition active:scale-90 ${
                mode === 'reader'
                  ? 'bg-[#007AFF] text-white shadow-[0_2px_8px_rgba(0,122,255,0.45)]'
                  : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'
              }`}
            >
              <BookOpen className="h-[15px] w-[15px]" strokeWidth={2.2} />
            </button>
            {/* 关闭 */}
            <button
              type="button"
              aria-label="关闭 AI 浏览器"
              onClick={closePanel}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/60 transition active:scale-90 dark:bg-white/10 dark:text-white/60"
            >
              <X className="h-[15px] w-[15px]" strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* AI 唤起来源提示条（工具触发时让机主知道是 AI 打开的） */}
          {origin === 'ai' ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex justify-center">
              <span className="mt-2 rounded-full bg-black/70 px-3 py-[4px] text-[11px] font-medium text-white shadow-lg backdrop-blur-sm">
                TA 给你打开了这个网页
              </span>
            </div>
          ) : null}

          {mode === 'web' ? (
            displayUrl ? (
              <>
                <iframe
                  key={displayUrl}
                  src={displayUrl}
                  title="AI 浏览器"
                  onLoad={() => setIframeSlow(false)}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  className="h-full w-full border-0 bg-white"
                />
                {/* 慢加载/被拒嵌逃生条 */}
                {iframeSlow ? (
                  <div className="absolute inset-x-0 bottom-0 z-[2] flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-7">
                    <p className="flex-1 text-[11px] leading-tight text-white/90">网页加载较慢，或该站点不允许内嵌浏览。</p>
                    <button
                      type="button"
                      onClick={() => setMode('reader')}
                      className="shrink-0 rounded-full bg-white/90 px-2.5 py-[4px] text-[11px] font-medium text-black shadow-md active:scale-95"
                    >
                      阅读模式
                    </button>
                    <button
                      type="button"
                      onClick={() => displayUrl && window.open(displayUrl, '_blank', 'noopener')}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-white/25 px-2.5 py-[4px] text-[11px] font-medium text-white ring-1 ring-white/40 backdrop-blur-sm active:scale-95"
                    >
                      <ArrowUpRight className="h-[11px] w-[11px]" strokeWidth={2.4} />
                      新窗口
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#F5F5F7] to-[#EDEDF0] px-8 dark:from-[#1C1C1E] dark:to-[#141416]">
                <span className="grid h-[46px] w-[46px] place-items-center rounded-[14px] bg-[#007AFF]/12 text-[#007AFF]">
                  <Search className="h-[21px] w-[21px]" strokeWidth={2} />
                </span>
                <p className="text-[13.5px] font-semibold text-black/70 dark:text-white/70">AI 浏览器</p>
                <p className="text-center text-[11.5px] leading-relaxed text-black/40 dark:text-white/40">
                  输入网址或搜索词（{engineName}）开始
                  <br />
                  聊天里让 TA 搜资料、发链接也会在这里打开
                </p>
              </div>
            )
          ) : (
            /* 阅读模式：服务端抽取的纯正文（可被 AI 高亮点亮；已有正文时 stale loading 不拦展示） */
            <div className="h-full overflow-y-auto overscroll-contain bg-[#FAFAF8] dark:bg-[#161618]">
              {reading && !readerPage?.text ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-black/35 dark:text-white/35">
                  <Loader2 className="h-[22px] w-[22px] animate-spin" />
                  <p className="text-[12.5px]">正在提取网页正文…</p>
                </div>
              ) : readerPage?.text ? (
                <div className="px-4 pb-6 pt-3">
                  <p className="text-[15px] font-bold leading-snug text-black/90 dark:text-white/90">{readerPage.title}</p>
                  <p className="mt-1 text-[10.5px] text-black/35 dark:text-white/35">{hostOf(readerPage.url)} · 阅读模式</p>
                  {readerPage.desc ? (
                    <p className="mt-2 rounded-[8px] bg-black/[0.04] px-2.5 py-2 text-[11.5px] leading-relaxed text-black/55 dark:bg-white/[0.06] dark:text-white/50">
                      {readerPage.desc}
                    </p>
                  ) : null}
                  {readerPage.truncated ? (
                    <p className="mt-2 text-[10.5px] text-[#FF9F0A]">正文较长，已截取前 5000 字</p>
                  ) : null}
                  <div className="mt-2 border-t border-black/[0.06] pt-2 dark:border-white/[0.08]" />
                  <ReaderParagraphs text={readerPage.text} highlight={highlight} />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-black/35 dark:text-white/35">
                  <BookOpen className="h-[22px] w-[22px]" strokeWidth={2} />
                  <p className="text-[12.5px]">先在上方输入网址，再切到阅读模式</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
