'use client';

/**
 * AI 专属分屏浏览器 —— 底部半屏分屏面板（第二十九轮核心 UI，PhoneShell 壳层 z-59）。
 *
 * 需求规格（机主：AI 系统感知工具包 + AI 专属分屏浏览器）：
 *  - 不是全屏弹窗！从底部弹出的【半屏分屏面板（Bottom Sheet）】：
 *    上半屏 = AI 与用户的聊天界面（保持可见和互动，App 窗口 z-40 在面板下方照常可点）；
 *    下半屏（1/2 屏幕）= AI 的内置浏览器。
 *  - 触发：AI 需要搜索资料 / 用户发了链接 / AI 主动想分享网页（工具 openWebBrowser 唤起）、
 *    屏幕侧边浏览器悬浮球（AIBrowserBall，常驻入口）、聊天里点网页分享卡片（origin='link'）。
 *
 * 双模式：
 *  - 网页模式（web）：iframe 直接加载（保真浏览；部分站点 X-Frame-Options 拒嵌时给出
 *    「新窗口打开/切阅读模式」逃生条）；
 *  - 阅读模式（reader）：服务端 /api/web-tools/read 抽取的纯正文（Jina Reader 风格），
 *    AI 的高亮工具（highlightWebText）在阅读模式下点亮文本并滚动到位——跨域 iframe
 *    无法注入脚本，阅读模式是「AI 帮你看这里」的落地载体。
 *
 * 状态源：ai-browser-store（zustand 全局单例，工具执行器/聊天卡片/悬浮球共用）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Globe, Loader2, Search, X } from 'lucide-react';
import { useAIBrowser, type AIBrowserPage } from '@/lib/ios/ai-browser-store';

/** 面板占壳高的比例（需求：下半屏 1/2 屏幕） */
const SHEET_RATIO = 0.5;

/** URL/搜索词归一：带协议的当网址，其余当搜索词 */
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

  // 高亮命中段：包含目标文本的首段（AI highlightWebText 工具触发；seq 变化重新定位）
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
            className={`mb-3 text-[14.5px] leading-[1.75] ${
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

export default function AIBrowserSheet() {
  const { open, origin, mode, page, highlight, reading, openPanel, closePanel, setMode, setPage, setLoading, clearHighlight, goBack } = useAIBrowser();
  const historyLen = useAIBrowser((s) => s.history.length);
  const [input, setInput] = useState('');
  const [shown, setShown] = useState(false); // 入场动画态
  const [readerPage, setReaderPage] = useState<AIBrowserPage | null>(null); // 阅读模式数据
  const [iframeSlow, setIframeSlow] = useState(false); // iframe 加载缓慢/被拒嵌提示
  const inputFocus = useRef(false);

  // 打开时同步地址栏 + 入场动画 + 慢加载检测复位；重置阅读 loading（跨热重载/重开的脏态）
  useEffect(() => {
    if (open) {
      setShown(true);
      setInput(page?.url ?? '');
      setIframeSlow(false);
      setLoading(false); // 开面板即清 stale loading（zustand 模块态跨热重载/重开存留，不重置会永久卡「提取中」）
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
        setPage(p); // 回写 store（AI 感知注入用）
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

  // 模式切换离开阅读模式时清高亮
  useEffect(() => {
    if (mode !== 'reader') clearHighlight();
  }, [mode, clearHighlight]);

  // 网页模式慢加载检测（6s 仍无 onLoad → 弹逃生条：X-Frame-Options 拒嵌的可能）
  useEffect(() => {
    if (!open || mode !== 'web' || !page?.url) return;
    setIframeSlow(false);
    const timer = window.setTimeout(() => setIframeSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [open, mode, page?.url]);

  if (!open) return null;

  const displayUrl = page?.url ?? '';

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[59]"
      style={{ height: `${SHEET_RATIO * 100}%` }}
      data-testid="ai-browser-sheet"
      role="dialog"
      aria-label="AI 分屏浏览器"
    >
      {/* 半屏面板本体：从底部滑入 */}
      <div
        className={`pointer-events-auto absolute inset-x-0 bottom-0 flex h-full flex-col overflow-hidden rounded-t-[22px] border-t border-black/10 bg-[#F5F5F7] shadow-[0_-14px_44px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.06] transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] dark:border-white/15 dark:bg-[#1C1C1E] dark:ring-white/10 ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* 拖拽条 + 工具栏 */}
        <div className="shrink-0 border-b border-black/[0.07] bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#2A2A2C]/90">
          {/* 抓手 */}
          <div className="flex justify-center pt-[7px]">
            <button
              type="button"
              aria-label="收起分屏浏览器"
              onClick={closePanel}
              className="h-[5px] w-[38px] rounded-full bg-black/20 transition active:bg-black/35 dark:bg-white/25"
            />
          </div>
          {/* 地址/搜索栏 + 工具按钮 */}
          <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1.5">
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
                placeholder="搜索或输入网址"
                aria-label="地址栏：搜索或输入网址"
                enterKeyHint="go"
                className="min-w-0 flex-1 bg-transparent text-[13px] leading-none text-black/85 outline-none placeholder:text-black/30 dark:text-white/85 dark:placeholder:text-white/30"
              />
              {page?.title ? (
                <span className="hidden max-w-[90px] truncate text-[11px] text-black/35 dark:text-white/35 sm:block">{hostOf(displayUrl)}</span>
              ) : null}
            </form>
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
              aria-label="关闭分屏浏览器"
              onClick={closePanel}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/60 transition active:scale-90 dark:bg-white/10 dark:text-white/60"
            >
              <X className="h-[15px] w-[15px]" strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* AI 唤起来源提示条（工具触发时让机主知道是 AI 打开的；几秒后淡出无需常驻） */}
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
                  title="AI 分屏浏览器"
                  onLoad={() => setIframeSlow(false)}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  className="h-full w-full border-0 bg-white"
                />
                {/* 慢加载/被拒嵌逃生条 */}
                {iframeSlow ? (
                  <div className="absolute inset-x-0 bottom-0 z-[2] flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-8">
                    <p className="flex-1 text-[11.5px] leading-tight text-white/90">
                      网页加载较慢，或该站点不允许内嵌浏览。
                    </p>
                    <button
                      type="button"
                      onClick={() => setMode('reader')}
                      className="shrink-0 rounded-full bg-white/90 px-3 py-[5px] text-[11.5px] font-medium text-black shadow-md active:scale-95"
                    >
                      切阅读模式
                    </button>
                    <button
                      type="button"
                      onClick={() => displayUrl && window.open(displayUrl, '_blank', 'noopener')}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-white/25 px-3 py-[5px] text-[11.5px] font-medium text-white ring-1 ring-white/40 backdrop-blur-sm active:scale-95"
                    >
                      <ArrowUpRight className="h-[12px] w-[12px]" strokeWidth={2.4} />
                      新窗口
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#F5F5F7] to-[#EDEDF0] px-8 dark:from-[#1C1C1E] dark:to-[#141416]">
                <span className="grid h-[52px] w-[52px] place-items-center rounded-[15px] bg-[#007AFF]/12 text-[#007AFF]">
                  <Search className="h-[24px] w-[24px]" strokeWidth={2} />
                </span>
                <p className="text-[14px] font-semibold text-black/70 dark:text-white/70">AI 浏览器</p>
                <p className="text-center text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                  输入网址或搜索词开始浏览
                  <br />
                  聊天里让 TA 搜资料、发链接，也会在这里打开
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
                <div className="px-4 pb-6 pt-4">
                  <p className="text-[16px] font-bold leading-snug text-black/90 dark:text-white/90">{readerPage.title}</p>
                  <p className="mt-1 text-[10.5px] text-black/35 dark:text-white/35">{hostOf(readerPage.url)} · 阅读模式</p>
                  {readerPage.desc ? (
                    <p className="mt-2 rounded-[8px] bg-black/[0.04] px-2.5 py-2 text-[12px] leading-relaxed text-black/55 dark:bg-white/[0.06] dark:text-white/50">
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
