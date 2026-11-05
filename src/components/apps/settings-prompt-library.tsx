'use client';

/**
 * 设置 · 全量提示词库（Prompt Library）—— 把系统内发给大模型的**全部**提示词，
 * 按「App 分组折叠 → 分类折叠 → 条目卡片」三级展示（只读浏览）。
 *
 * 数据源：public/prompt-library/*.json（由 scripts/build-prompt-library.ts 从
 * prompts/ 下 4 份全量提取文档构建，503 条一字不差原文），按 App 懒加载；
 * 搜索时拉取全部分组做跨 App 过滤。
 *
 * 覆盖：微信/QQ（核心角色 + 动作类：买东西、发红包、转账、亲属卡、礼物、引用、
 * 转发、撤回、拍一拍… + 生成类 + 消息/感知/系统事件/群聊）、信息、电话、朋友圈、
 * 论坛、情侣空间、线下见面、淘宝（AI 客服 + 生成规则）、美团（生成规则）、音乐、
 * 记忆、世界书、情绪行为、视觉头像、跨应用关系、全局人设、其他工具。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bird,
  BookOpen,
  Brain,
  ChevronDown,
  Heart,
  Images,
  MapPin,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Music,
  Network,
  Phone,
  Search,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
  User,
  Wrench,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar } from '@/components/ios/IOSNavBar';
import { Input } from '@/components/ui/input';

// ---------------- 数据类型（与 public/prompt-library/*.json 对应） ----------------

interface LibEntry {
  n: string;
  title: string;
  file: string;
  trigger: string;
  role: string;
  text: string;
}
interface LibCategory {
  name: string;
  entries: LibEntry[];
}
interface LibApp {
  id: string;
  name: string;
  desc: string;
  count: number;
  categories: LibCategory[];
}
interface LibIndex {
  total: number;
  apps: { id: string; name: string; desc: string; count: number }[];
}

/** App 分组 → 图标 / 主色（参照系统各 App 品牌色） */
const APP_META: Record<string, { icon: LucideIcon; tone: string }> = {
  wechat: { icon: MessageCircle, tone: '#34C759' },
  qq: { icon: Bird, tone: '#12B7F5' },
  chat: { icon: MessageSquareText, tone: '#34C759' },
  phone: { icon: Phone, tone: '#34C759' },
  moments: { icon: Images, tone: '#FF9500' },
  forum: { icon: MessagesSquare, tone: '#5856D6' },
  couple: { icon: Heart, tone: '#FF375F' },
  offline: { icon: MapPin, tone: '#FF9500' },
  taobao: { icon: ShoppingBag, tone: '#FF6A00' },
  meituan: { icon: UtensilsCrossed, tone: '#FFC300' },
  music: { icon: Music, tone: '#FF375F' },
  memory: { icon: Brain, tone: '#AF52FF' },
  worldbook: { icon: BookOpen, tone: '#32ADE6' },
  behavior: { icon: Sparkles, tone: '#AF52FF' },
  vision: { icon: Eye, tone: '#32ADE6' },
  crossapp: { icon: Network, tone: '#5856D6' },
  global: { icon: User, tone: '#8E8E93' },
  tools: { icon: Wrench, tone: '#8E8E93' },
};

// ---------------- 模块级缓存（跨挂载复用，避免重复拉取） ----------------

const appCache = new Map<string, LibApp>();

async function loadApp(id: string): Promise<LibApp> {
  const hit = appCache.get(id);
  if (hit) return hit;
  const res = await fetch(`/prompt-library/${id}.json`);
  if (!res.ok) throw new Error(`加载 ${id} 失败`);
  const data = (await res.json()) as LibApp;
  appCache.set(id, data);
  return data;
}

// ---------------- 外壳与卡片（与 settings.tsx 同风格，独立实现避免循环依赖） ----------------

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col bg-[#F2F2F7] dark:bg-transparent">
      <IOSNavBar title={title} large={false} left={<IOSBackButton onClick={onBack} label="" />} className="bg-transparent! backdrop-blur-none!" />
      <div className="no-scrollbar relative flex-1 overflow-y-auto">
        <div key={title} className="animate-in slide-in-from-right-6 fade-in duration-300 px-4 pb-[40px] pt-2">
          {children}
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
      {children}
    </div>
  );
}

function AppIcon({ id }: { id: string }) {
  const meta = APP_META[id] ?? APP_META.global;
  const Icon = meta.icon;
  return (
    <span
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] shadow-[0_2px_6px_rgba(17,24,39,0.12)]"
      style={{ backgroundColor: meta.tone }}
      aria-hidden
    >
      <Icon className="h-[18px] w-[18px] text-white" strokeWidth={2.4} />
    </span>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-[2px] text-[11px] font-medium text-muted-foreground dark:bg-white/10">
      {n} 条
    </span>
  );
}

// ---------------- 条目卡片 ----------------

function EntryCard({ entry, defaultOpen = false }: { entry: LibEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={open}
      >
        {entry.n && (
          <span className="mt-[1px] shrink-0 rounded-[5px] bg-black/[0.05] px-1.5 py-[1px] font-mono text-[10px] leading-[15px] text-muted-foreground dark:bg-white/10">
            {entry.n}
          </span>
        )}
        <span className="min-w-0 flex-1 text-[14px] leading-snug font-medium">{entry.title}</span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {entry.file && (
            <p className="font-mono text-[10.5px] leading-relaxed break-all text-muted-foreground">{entry.file.replace(/`/g, '')}</p>
          )}
          {entry.trigger && (
            <p className="rounded-[10px] bg-black/[0.04] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted-foreground dark:bg-white/[0.07]">
              <span className="font-medium">触发场景：</span>
              {entry.trigger}
            </p>
          )}
          <pre className="thin-scrollbar max-h-72 overflow-y-auto overscroll-contain rounded-[12px] bg-black/[0.045] px-3 py-2.5 font-mono text-[11px] leading-[1.7] break-words whitespace-pre-wrap text-foreground/90 dark:bg-black/25">
            {entry.text}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------- 主页面 ----------------

export default function PromptLibraryPage({ onBack }: { onBack: () => void }) {
  const [index, setIndex] = useState<LibIndex | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appData, setAppData] = useState<Record<string, LibApp>>({});
  const [appLoading, setAppLoading] = useState<string | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/prompt-library/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index 加载失败'))))
      .then((d: LibIndex) => alive && setIndex(d))
      .catch(() => alive && setLoadErr('提示词库索引加载失败，请重试'));
    return () => {
      alive = false;
    };
  }, []);

  /** 展开/收起 App 分组：首次展开时懒加载该 App 的 JSON */
  const toggleApp = useCallback(async (id: string) => {
    setExpandedCat(null);
    if (expandedApp === id) {
      setExpandedApp(null);
      return;
    }
    setExpandedApp(id);
    if (!appCache.has(id) && !appData[id]) {
      setAppLoading(id);
      try {
        const data = await loadApp(id);
        setAppData((m) => ({ ...m, [id]: data }));
      } finally {
        setAppLoading(null);
      }
    }
  }, [appData, expandedApp]);

  /** 搜索：拉取尚未缓存的分组后跨 App 过滤（appCache 由 loadApp 统一注水） */
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return;
    let alive = true;
    const missing = index.apps.filter((a) => !appCache.has(a.id));
    if (missing.length === 0) return;
    Promise.all(missing.map((a) => loadApp(a.id).catch(() => null)))
      .then((arr) => {
        if (!alive) return;
        setAppData((m) => {
          const next = { ...m };
          arr.forEach((d) => {
            if (d) next[d.id] = d;
          });
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [query, index]);

  /** 搜索结果：条目标题/正文/文件/触发场景/分类名命中 */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return null;
    const out: { app: LibIndex['apps'][number]; categories: { name: string; entries: LibEntry[] }[] }[] = [];
    for (const meta of index.apps) {
      const data = appData[meta.id] ?? appCache.get(meta.id);
      if (!data) continue;
      const cats = data.categories
        .map((c) => ({ name: c.name, entries: c.entries.filter((e) => {
          const hay = `${e.title}\n${e.text}\n${e.file}\n${e.trigger}\n${c.name}`.toLowerCase();
          return hay.includes(q);
        }) }))
        .filter((c) => c.entries.length > 0);
      if (cats.length > 0) out.push({ app: meta, categories: cats });
    }
    return out;
  }, [query, index, appData]);

  const searchingAll = query.trim().length > 0;

  return (
    <Shell title="全量提示词库" onBack={onBack}>
      {/* 总览卡 */}
      <Card>
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <p className="text-[14px] font-semibold">
            系统内发给大模型的全部提示词
            {index && <span className="ml-2 font-normal text-muted-foreground">共 {index.apps.length} 个 App 分组 · {index.total} 条</span>}
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            微信/QQ 的核心角色与全部动作（买东西、发红包、转账、亲属卡、送礼物、引用、转发、撤回、拍一拍…）、淘宝 AI 客服、淘宝/美团生成规则、信息、电话、朋友圈、论坛、情侣空间、记忆、世界书……原文一字不差，只读浏览。
          </p>
        </div>
      </Card>

      {/* 搜索框 */}
      <div className="relative mt-3 mb-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索全部提示词（标题 / 正文 / 文件 / 场景）"
          className="h-10 rounded-[14px] bg-white/60 pl-9 text-[13px] shadow-[0_4px_18px_rgba(17,24,39,0.06)] ring-1 ring-black/5 dark:bg-white/[0.08] dark:ring-white/10"
          inputMode="search"
        />
      </div>

      {loadErr && <p className="px-1 py-3 text-[12px] text-red-500">{loadErr}</p>}

      {/* 搜索模式：跨 App 扁平分组结果（加载完成前先展示已缓存分组，其余陆续补齐） */}
      {searchingAll && (
        <div className="mt-2 flex flex-col gap-2.5" data-testid="prompt-library-search">
          {searchResults && searchResults.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">没有匹配「{query.trim()}」的提示词</p>
          )}
          {searchResults?.map(({ app, categories }) => (
            <div key={app.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <AppIcon id={app.id} />
                <span className="text-[13px] font-semibold">{app.name}</span>
                <CountBadge n={categories.reduce((s, c) => s + c.entries.length, 0)} />
              </div>
              {categories.map((c, ci) => (
                <Card key={`${app.id}-${ci}`}>
                  <p className="px-4 pt-3 text-[11.5px] font-medium text-muted-foreground">{c.name}</p>
                  {c.entries.map((e, ei) => (
                    <EntryCard key={`${app.id}-${ci}-${ei}`} entry={e} />
                  ))}
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 浏览模式：App 分组折叠 → 分类折叠 */}
      {!searchingAll && (
        <div className="mt-2 flex flex-col gap-2.5" data-testid="prompt-library-apps">
          {index?.apps.map((meta) => {
            const open = expandedApp === meta.id;
            const data = appData[meta.id];
            const loading = appLoading === meta.id;
            return (
              <Card key={meta.id}>
                <button
                  type="button"
                  onClick={() => void toggleApp(meta.id)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/50"
                  aria-expanded={open}
                  data-testid={`prompt-lib-app-${meta.id}`}
                >
                  <AppIcon id={meta.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[16px] font-medium">{meta.name}</span>
                      <CountBadge n={meta.count} />
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{meta.desc}</span>
                  </span>
                  <ChevronDown className={`h-[18px] w-[18px] shrink-0 text-muted-foreground/70 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="flex flex-col gap-2.5 bg-black/[0.02] px-3 py-3 dark:bg-black/[0.12]">
                    {loading && <p className="px-1 py-2 text-[12px] text-muted-foreground">正在加载…</p>}
                    {data?.categories.map((cat, ci) => {
                      const catKey = `${meta.id}::${ci}`;
                      const catOpen = expandedCat === catKey;
                      return (
                        <div key={catKey} className="overflow-hidden rounded-[16px] bg-white/70 ring-1 ring-black/[0.04] dark:bg-white/[0.07] dark:ring-white/[0.07]">
                          <button
                            type="button"
                            onClick={() => setExpandedCat(catOpen ? null : catKey)}
                            className="flex min-h-[44px] w-full items-center gap-2 px-3.5 py-2 text-left transition-colors active:bg-muted/50"
                            aria-expanded={catOpen}
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{cat.name}</span>
                            <CountBadge n={cat.entries.length} />
                            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${catOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {catOpen && (
                            <div className="divide-y divide-black/[0.05] border-t border-black/[0.04] dark:divide-white/[0.06] dark:border-white/[0.06]">
                              {cat.entries.map((e, ei) => (
                                <EntryCard key={ei} entry={e} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 收录说明 */}
      <p className="mt-4 px-2 text-[10.5px] leading-relaxed text-muted-foreground/80">
        收录口径：只收真正发给大模型的文本（system / user 消息、规则块、决策与生成提示词、LLM 可见的上下文序列化格式），纯 UI 文案不收录。微信/QQ 里「买东西」的美团·淘宝联动规则全文在微信/QQ 分组的动作类下；外卖配送进度、骑手消息、物流轨迹等为本地状态机（无提示词）。数据由 scripts/build-prompt-library.ts 从提取文档构建。
      </p>
    </Shell>
  );
}
