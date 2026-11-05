'use client';

/**
 * 默认预设 · 按 App 整合的统一页面主体（v70 · 简约重制）。
 *
 * 页面主体 = 18 个 App 折叠面板（全局·核心人设置顶），点开任一 App，
 * 面板内是该 App 的全部提示词与规则，分两段——
 *
 * - 预设模块（renderAppModules 回调注入，宿主 settings.tsx 渲染）：
 *   prompt-entries.ts 注册表的组卡（整块编辑 / 组开关 / 注入深度 / 多选批量）
 *   + 该 App 的自定义条目卡；
 * - 提示词库（本组件懒加载 public/prompt-library/{id}.json）：
 *   分类折叠 → 条目行（逐条开关 / 编辑 / 恢复默认；v71 隐藏触发场景与原文展示，
 *   只留编辑框——编辑框预填的就是当前生效文本）。
 *
 * 两段共用同一套状态存储（kv: prompt-entries:state，prompt-entries-client
 * 写穿 + 服务端同步）：模块组开关/编辑走组 id，库条目走 `lib:<key>` 前缀。
 * 接线状态：public/prompt-library/wired.json（scripts/build-prompt-wired.ts
 * 扫描源码生成）。已接线 = 修改/开关即时生效；存档 = 先保存待接入。
 *
 * v70 简约 + 提速（用户反馈「再简约一点 / 加载慢」）：
 * - 视觉降噪：去掉说明大卡/统计徽章/编号 chip/描述行——头部只剩一行灰字统计，
 *   App 行 = 图标 + 名称 + 右侧灰字条数；条目行 = 标题 + 状态小圆点
 *   （绿=已接线 / 灰=存档 / 橙=已编辑）+ 开关；
 * - 渲染提速：去掉全部列表项 backdrop-blur / saturate / transition-all
 *   （数百层叠毛玻璃是展开与滚动的卡顿根源），改为实底白卡 + 仅箭头旋转过渡。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bird,
  BookOpen,
  Brain,
  ChevronDown,
  Eye,
  Heart,
  Images,
  MapPin,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Music,
  Network,
  Phone,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  User,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  ensurePromptEntriesClientReady,
  readPromptEntryState,
  resetPromptEntry,
  setPromptEntryEnabled,
  setPromptEntryText,
} from '@/lib/ios/prompt-entries-client';

// ---------------- 数据类型（与 public/prompt-library/*.json 对应） ----------------

interface LibEntry {
  key: string;
  n?: string;
  title: string;
  file?: string;
  trigger?: string;
  role?: string;
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

// ---------------- 简约设计令牌（实底白卡，无 blur） ----------------

/** L1 面板：iOS 设置风实底白卡 */
const PANEL =
  'overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.05] dark:bg-[#1C1C1E] dark:ring-white/[0.08]';

/** L2 分类块：浅灰底内嵌块 */
const SUB =
  'overflow-hidden rounded-[12px] bg-black/[0.035] dark:bg-white/[0.06]';

/** L3 条目行：收起 = 白胶囊，展开 = 圆角白卡（仅 radius 过渡，无 blur） */
const entryShell = (open: boolean, off: boolean) =>
  `overflow-hidden bg-white ring-1 ring-black/[0.05] dark:bg-[#2A2A2C] dark:ring-white/[0.08] ${
    open ? 'rounded-[14px]' : 'rounded-full'
  } ${off ? 'opacity-55' : ''}`;

/** 编辑框 */
const TEXTAREA =
  'rounded-[12px] border-0 bg-black/[0.03] ring-1 ring-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 dark:bg-white/[0.06] dark:ring-white/10';

/** 次级按钮（无阴影无 blur） */
const BTN_GHOST =
  'flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-[6px] text-[11.5px] font-medium text-foreground/70 transition-colors active:bg-black/[0.08] disabled:opacity-40 dark:bg-white/10 dark:text-muted-foreground';

/** App 分组 → 图标 / 主色（参照系统各 App 品牌色） */
const APP_META: Record<string, { icon: LucideIcon; tone: string }> = {
  wechat: { icon: MessageCircle, tone: '#34C759' },
  qq: { icon: Bird, tone: '#12B7F5' },
  chat: { icon: MessageSquareText, tone: '#34C759' },
  taobao: { icon: ShoppingBag, tone: '#FF6A00' },
  meituan: { icon: UtensilsCrossed, tone: '#FFC300' },
  phone: { icon: Phone, tone: '#34C759' },
  moments: { icon: Images, tone: '#FF9500' },
  forum: { icon: MessagesSquare, tone: '#5856D6' },
  couple: { icon: Heart, tone: '#FF375F' },
  offline: { icon: MapPin, tone: '#FF9500' },
  music: { icon: Music, tone: '#FF375F' },
  memory: { icon: Brain, tone: '#AF52FF' },
  worldbook: { icon: BookOpen, tone: '#32ADE6' },
  behavior: { icon: Sparkles, tone: '#AF52FF' },
  vision: { icon: Eye, tone: '#32ADE6' },
  crossapp: { icon: Network, tone: '#5856D6' },
  global: { icon: User, tone: '#8E8E93' },
  tools: { icon: Wrench, tone: '#8E8E93' },
};

/** 原文 `${token}` → 编辑版 `{{token}}`（仅转换简单标识符，复杂表达式原样保留） */
function tokenize(t: string): string {
  return t.replace(/\$\{(\w+)\}/g, '{{$1}}');
}

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

// ---------------- 小组件 ----------------

/** 状态小圆点（替代徽章胶囊）：绿=已接线 / 灰=存档 / 橙=已编辑 */
function StatusDot({ tone, title }: { tone: 'green' | 'orange' | 'gray'; title: string }) {
  const tones = { green: '#34C759', orange: '#FF9500', gray: '#B0B0B5' };
  return <span title={title} aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: tones[tone] }} />;
}

/** 面板内分节小标签（预设模块） */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 pb-0.5 pt-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80">{children}</div>;
}

// ---------------- 条目行（开关 / 编辑 / 恢复默认） ----------------

function LibEntryCard({
  entry,
  wired,
  off,
  editedText,
  onToggle,
  onSave,
  onReset,
}: {
  entry: LibEntry;
  wired: boolean;
  off: boolean;
  editedText: string | undefined;
  onToggle: (key: string, on: boolean) => void;
  onSave: (key: string, text: string) => void;
  onReset: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const template = editedText ?? tokenize(entry.text);
  const dirty = editedText !== undefined || off;

  return (
    <div data-testid={`lib-entry-${entry.key}`} className={entryShell(open, off)}>
      {/* 行头：标题 + 状态圆点 + 开关 + 右侧箭头 */}
      <div className="flex items-center gap-2 px-3 py-[6px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          <span className="min-w-0 flex-1 truncate text-[13px]">{entry.title}</span>
        </button>
        <span className="flex shrink-0 items-center gap-2">
          {editedText !== undefined ? (
            <StatusDot tone="orange" title="已编辑" />
          ) : (
            <StatusDot
              tone={wired ? 'green' : 'gray'}
              title={wired ? '已接线：修改与开关即时生效' : '存档：编辑与开关先保存，暂未接入运行时'}
            />
          )}
          <Switch
            checked={!off}
            onCheckedChange={(v) => onToggle(entry.key, v)}
            aria-label={`启用 ${entry.title}`}
            data-testid={`lib-switch-${entry.key}`}
          />
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </div>

      {/* 展开区：文件出处 / 编辑框（v71 简约：不再展示触发场景与原文，编辑框预填当前生效文本） */}
      {open && (
        <div className="border-t border-black/[0.05] px-3 py-2.5 dark:border-white/[0.08]">
          {entry.file && (
            <p className="mb-1.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground/70">{entry.file.replace(/`/g, '')}</p>
          )}
          <Textarea
            value={editing ? (draft as string) : template}
            onChange={(ev) => setDraft(ev.target.value)}
            className={`mt-2 min-h-36 font-mono text-[11px] leading-relaxed ${TEXTAREA}`}
            data-testid={`lib-text-${entry.key}`}
          />
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
            编辑版支持 {'{{token}}'} 占位符（留空保存 = 恢复默认文本）
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(entry.key, draft ?? '');
                setDraft(null);
              }}
              disabled={!editing}
              className="rounded-full bg-[#007AFF] px-4 py-[6px] text-[11.5px] font-medium text-white transition-colors active:bg-[#0066D6] disabled:opacity-40"
              data-testid={`lib-save-${entry.key}`}
            >
              保存修改
            </button>
            {editing && (
              <button type="button" onClick={() => setDraft(null)} className={BTN_GHOST}>
                取消编辑
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onReset(entry.key);
                setDraft(null);
              }}
              disabled={!dirty}
              className={BTN_GHOST}
            >
              <RefreshCw className="h-3 w-3" />
              恢复默认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 页面主体：按 App 整合的统一面板列表 ----------------

export function PresetAppPanels({
  onToast,
  moduleCount,
  appModuleCount,
  renderAppModules,
  requestOpenApp,
}: {
  onToast: (m: string) => void;
  /** 预设模块总数（头部统计；含自定义组） */
  moduleCount?: number;
  /** 某个 App 的预设模块数（0 = 无模块段） */
  appModuleCount?: (appId: string) => number;
  /** 渲染某 App 的预设模块组卡（含自定义条目卡）；返回 null = 该 App 无模块 */
  renderAppModules?: (appId: string) => ReactNode;
  /** 新增自定义条目后自动展开对应 App 面板（nonce 变化触发） */
  requestOpenApp?: { appId: string; nonce: number } | null;
}) {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const [index, setIndex] = useState<LibIndex | null>(null);
  const [wiredSet, setWiredSet] = useState<Set<string>>(new Set());
  const [appData, setAppData] = useState<Record<string, LibApp>>({});
  const [loadingApp, setLoadingApp] = useState<string | null>(null);
  const [openApps, setOpenApps] = useState<Set<string>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // 挂载兜底注册（PhoneShell 已注册时幂等）
  useEffect(() => {
    ensurePromptEntriesClientReady();
  }, []);

  // 索引 + 接线清单
  useEffect(() => {
    let alive = true;
    fetch('/prompt-library/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index 加载失败'))))
      .then((d: LibIndex) => alive && setIndex(d))
      .catch(() => undefined);
    fetch('/prompt-library/wired.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('wired 加载失败'))))
      .then((d: { wired?: string[] }) => {
        if (alive && Array.isArray(d?.wired)) setWiredSet(new Set(d.wired));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 当前状态（与预设模块卡同一存储）
  const state = readPromptEntryState();
  const disabled = useMemo(() => new Set(state.disabled), [state.disabled, state.disabled.length]);

  /** 展开/收起 App 面板：首次展开时懒加载该 App 的 JSON */
  const toggleApp = useCallback(
    async (id: string) => {
      setOpenApps((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!appCache.has(id) && !appData[id]) {
        setLoadingApp(id);
        try {
          const data = await loadApp(id);
          setAppData((m) => ({ ...m, [id]: data }));
        } catch {
          /* 静默：面板内显示加载失败态 */
        } finally {
          setLoadingApp(null);
        }
      }
    },
    [appData],
  );

  // 新增自定义条目后：自动展开对应 App 面板（nonce 变化触发；已展开则跳过）。
  // setTimeout 0 推迟到下一个宏任务——避免 effect 内同步 setState 触发级联渲染告警
  useEffect(() => {
    const req = requestOpenApp;
    if (!req) return;
    if (openApps.has(req.appId)) return;
    const t = window.setTimeout(() => void toggleApp(req.appId), 0);
    return () => window.clearTimeout(t);
  }, [requestOpenApp?.nonce]);

  const toggleCat = (catKey: string) => {
    setOpenCats((cur) => {
      const next = new Set(cur);
      if (next.has(catKey)) next.delete(catKey);
      else next.add(catKey);
      return next;
    });
  };

  // 搜索：拉取尚未缓存的分组后跨 App 过滤
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return;
    const missing = index.apps.filter((a) => !appCache.has(a.id));
    if (missing.length === 0) return;
    let alive = true;
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

  // ---- 变更回调（与预设模块卡共用 prompt-entries-client，写穿 + 服务端同步） ----
  const onToggle = useCallback(
    (key: string, on: boolean) => {
      setPromptEntryEnabled(`lib:${key}`, on);
      refresh();
      onToast(
        wiredSet.has(key)
          ? on
            ? '已启用，下次发送即生效'
            : '已禁用，该条不再注入'
          : on
            ? '已启用（存档条目，暂未接入运行时）'
            : '已关闭（存档条目，暂未接入运行时）',
      );
    },
    [onToast, refresh, wiredSet],
  );
  const onSave = useCallback(
    (key: string, text: string) => {
      setPromptEntryText(`lib:${key}`, text);
      refresh();
      onToast(wiredSet.has(key) ? '已保存，下次发送即生效' : '已保存（存档条目，暂未接入运行时）');
    },
    [onToast, refresh, wiredSet],
  );
  const onReset = useCallback(
    (key: string) => {
      resetPromptEntry(`lib:${key}`);
      refresh();
      onToast('已恢复默认');
    },
    [onToast, refresh],
  );

  const renderEntry = (e: LibEntry) => (
    <LibEntryCard
      key={e.key}
      entry={e}
      wired={wiredSet.has(e.key)}
      off={disabled.has(`lib:${e.key}`)}
      editedText={state.edits[`lib:${e.key}`]}
      onToggle={onToggle}
      onSave={onSave}
      onReset={onReset}
    />
  );

  /** 搜索结果：条目标题/正文/文件/触发场景/分类名命中 */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return null;
    const out: { app: LibIndex['apps'][number]; categories: { name: string; entries: LibEntry[] }[] }[] = [];
    for (const meta of index.apps) {
      const data = appData[meta.id] ?? appCache.get(meta.id);
      if (!data) continue;
      const cats = data.categories
        .map((c) => ({
          name: c.name,
          entries: c.entries.filter((e) => {
            const hay = `${e.title}\n${e.text}\n${e.file ?? ''}\n${e.trigger ?? ''}\n${c.name}`.toLowerCase();
            return hay.includes(q);
          }),
        }))
        .filter((c) => c.entries.length > 0);
      if (cats.length > 0) out.push({ app: meta, categories: cats });
    }
    return out;
  }, [query, index, appData]);

  const searchingAll = query.trim().length > 0;

  /** App 面板顺序：全局·核心人设置顶（人设是所有链路的根基），其余按索引原序 */
  const orderedApps = useMemo(() => {
    if (!index) return [];
    const g = index.apps.find((a) => a.id === 'global');
    const rest = index.apps.filter((a) => a.id !== 'global');
    return g ? [g, ...rest] : rest;
  }, [index]);

  /** 某面板条目总数（模块数 + 库条数，头部右侧灰字） */
  const totalCountOf = (meta: { id: string; count: number }) => {
    const m = appModuleCount?.(meta.id) ?? 0;
    return m > 0 ? `${meta.count + m} 项` : `${meta.count} 条`;
  };

  return (
    <div data-testid="preset-library-section">
      {/* 头部统计：一行灰字（v70 简约：去掉说明大卡） */}
      <p className="px-1 pb-2.5 pt-1 text-[11.5px] text-muted-foreground">
        按 App 整理{index ? ` · ${index.apps.length} 个 App · ${index.total} 条提示词` : ''}
        {typeof moduleCount === 'number' && moduleCount > 0 ? ` · 模块 ${moduleCount} 组` : ''}
        {wiredSet.size > 0 ? ` · 已接线 ${wiredSet.size} 条（修改即时生效）` : ''}
      </p>

      {/* 搜索框（扁平） */}
      <div className="relative mb-2.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索全部提示词"
          className="h-10 rounded-full border-0 bg-white pl-9 pr-4 text-[13px] ring-1 ring-black/[0.06] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 dark:bg-[#1C1C1E] dark:ring-white/[0.1]"
          inputMode="search"
        />
      </div>

      {/* 搜索模式：跨 App 扁平分组结果 */}
      {searchingAll && (
        <div className="flex flex-col gap-2.5" data-testid="preset-library-search">
          {searchResults && searchResults.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">没有匹配「{query.trim()}」的提示词</p>
          )}
          {searchResults?.map(({ app, categories }) => (
            <div key={app.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1.5">
                <AppIcon id={app.id} />
                <span className="text-[13px] font-semibold">{app.name}</span>
                <span className="text-[11px] text-muted-foreground">{categories.reduce((s, c) => s + c.entries.length, 0)} 条命中</span>
              </div>
              {categories.map((c, ci) => (
                <div key={`${app.id}-${ci}`} className={SUB}>
                  <div className="flex min-h-[38px] items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{c.name}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                    {c.entries.map(renderEntry)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 浏览模式：App 折叠面板（预设模块 + 提示词库 同居一屏，v71 起两段不再分节标注） */}
      {!searchingAll && (
        <div className="flex flex-col gap-2" data-testid="preset-library-apps">
          {orderedApps.map((meta) => {
            const open = openApps.has(meta.id);
            const data = appData[meta.id];
            const loading = loadingApp === meta.id;
            const modules = renderAppModules?.(meta.id) ?? null;
            return (
              <div key={meta.id} className={PANEL}>
                <button
                  type="button"
                  onClick={() => void toggleApp(meta.id)}
                  className="flex min-h-[48px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                  aria-expanded={open}
                  data-testid={`preset-lib-app-${meta.id}`}
                >
                  <AppIcon id={meta.id} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{meta.name}</span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">{totalCountOf(meta)}</span>
                  <ChevronDown
                    className={`h-[18px] w-[18px] shrink-0 text-muted-foreground/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <div className="flex flex-col gap-1.5 border-t border-black/[0.05] px-2.5 py-2.5 dark:border-white/[0.08]">
                    {/* 段一：预设模块（组卡由宿主注入——整块编辑 / 组开关 / 深度 / 多选） */}
                    {modules != null && (
                      <>
                        <SectionLabel>预设模块</SectionLabel>
                        <div className="flex flex-col gap-1.5">{modules}</div>
                      </>
                    )}

                    {/* 段二：提示词库条目（分类折叠 → 条目行；v71 去掉分节标签） */}
                    {loading && <p className="px-1 py-2 text-[12px] text-muted-foreground">正在加载…</p>}
                    {!loading && !data && <p className="px-1 py-2 text-[12px] text-red-500">加载失败，请收起后重新展开重试</p>}
                    {data?.categories.length ? (
                      <>
                        {data.categories.map((cat, ci) => {
                          const catKey = `${meta.id}::${ci}`;
                          const catOpen = openCats.has(catKey);
                          return (
                            <div key={catKey} className={SUB}>
                              <button
                                type="button"
                                onClick={() => toggleCat(catKey)}
                                className="flex min-h-[40px] w-full items-center gap-2 px-3 py-1.5 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                                aria-expanded={catOpen}
                                data-testid={`preset-lib-cat-${meta.id}-${ci}`}
                              >
                                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{cat.name}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">{cat.entries.length} 条</span>
                                <ChevronDown
                                  className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${catOpen ? 'rotate-180' : ''}`}
                                />
                              </button>
                              {catOpen && (
                                <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-0.5">
                                  {cat.entries.map(renderEntry)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 口径说明：一行（v70 简约） */}
      <p className="mt-3.5 px-2 text-[10.5px] leading-relaxed text-muted-foreground/70">
        已接线条目修改即时生效；存档条目先保存待接入。同一提示词被多个面板共用时，任一面板关闭即不再注入。
      </p>
    </div>
  );
}

// ---------------- App 图标 ----------------

function AppIcon({ id }: { id: string }) {
  const meta = APP_META[id] ?? APP_META.global;
  const Icon = meta.icon;
  return (
    <span
      className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[8px]"
      style={{ backgroundColor: meta.tone }}
      aria-hidden
    >
      <Icon className="h-4 w-4 text-white" strokeWidth={2.2} />
    </span>
  );
}
