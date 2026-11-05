'use client';

/**
 * 默认预设 · 全量提示词库内嵌区（v68 · 毛玻璃胶囊重构）。
 *
 * 把系统内发给大模型的**全部**提示词（public/prompt-library/*.json，503 条原文，
 * 含动作类：买东西、发红包/转账/亲属卡、送礼物、引用、转发、撤回、拍一拍…；
 * 生成类：商品、帖子、商家、订单、图片…）以「App 折叠面板 → 分类折叠 → 条目胶囊」
 * 三级结构并入「默认预设（内置）」页，与上方预设模块卡共用同一套状态存储
 * （kv: prompt-entries:state，prompt-entries-client 写穿 + 服务端同步）：
 * - 开关 → disabled（已接线条目：下一次请求起不再注入）；
 * - 编辑 → edits（编辑版支持 {{token}} 占位符，原文 `${token}` 自动转换；已接线
 *   条目即时生效）；
 * - 恢复默认 → 清开关/清编辑。
 *
 * 接线状态徽章数据：public/prompt-library/wired.json（scripts/build-prompt-wired.ts
 * 扫描源码中的 `lib:<key>` 字面量生成）。已接线 = 修改/开关即时生效；
 * 存档 = 编辑与开关先保存，该条目暂未接入运行时链路（后续接线后自动生效）。
 *
 * v68 视觉：全页统一毛玻璃胶囊设计语言——
 * L1 玻璃面板（App 折叠卡）→ L2 玻璃子面板（分类）→ L3 条目胶囊
 * （收起 = 纯胶囊 rounded-full，展开 = 圆角玻璃卡，radius 过渡动画）；
 * 徽章/按钮/搜索框/深度调节全部胶囊化（rounded-full），
 * 品牌色按钮带同色光晕阴影，次级按钮为玻璃胶囊。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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

// ---------------- 毛玻璃胶囊设计令牌（与「默认预设」页共用同一套配方） ----------------

/** L1 玻璃面板：iOS 霜玻璃（App 折叠卡 / 说明卡），带顶部高光描边 */
const GLASS_PANEL =
  'overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl backdrop-saturate-150 dark:bg-white/[0.06] dark:ring-white/[0.09]';

/** L2 玻璃子面板：分类折叠（稍透，让 L3 胶囊浮起） */
const GLASS_SUB =
  'overflow-hidden rounded-[16px] bg-white/40 ring-1 ring-white/45 backdrop-blur-xl dark:bg-white/[0.045] dark:ring-white/[0.07]';

/** L3 条目胶囊：收起 = 纯胶囊，展开 = 圆角玻璃卡（radius 平滑过渡） */
const glassEntry = (open: boolean, off: boolean) =>
  `overflow-hidden bg-white/60 ring-1 ring-white/60 backdrop-blur-lg backdrop-saturate-150 transition-all duration-300 ease-out dark:bg-white/[0.07] dark:ring-white/[0.08] ${
    open ? 'rounded-[20px]' : 'rounded-full'
  } ${off ? 'opacity-60 saturate-[0.6]' : ''}`;

/** 玻璃胶囊文本输入（编辑框） */
const GLASS_TEXTAREA =
  'rounded-[16px] border-0 bg-white/65 ring-1 ring-black/[0.06] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 dark:bg-white/[0.08] dark:ring-white/10';

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

// ---------------- 胶囊小组件 ----------------

/** 通用玻璃胶囊徽章（统计数 / 标签） */
function Pill({
  tone = 'gray',
  className = '',
  children,
}: {
  tone?: 'gray' | 'green' | 'orange' | 'blue';
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    gray: 'bg-black/[0.05] text-muted-foreground dark:bg-white/10 dark:text-zinc-300',
    green: 'bg-[#34C759]/[0.14] text-[#248A3D] dark:text-[#30D158]',
    orange: 'bg-[#FF9500]/[0.15] text-[#C77700] dark:text-[#FF9500]',
    blue: 'bg-[#007AFF]/[0.12] text-[#0A6CFF] dark:text-[#409CFF]',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-medium backdrop-blur-md ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** 状态胶囊（已接线 / 存档 / 已编辑）：带呼吸小圆点 */
function StatusPill({ tone, label, title }: { tone: 'green' | 'orange' | 'gray'; label: string; title?: string }) {
  const tones = {
    green: 'bg-[#34C759]/[0.14] text-[#248A3D] dark:text-[#30D158]',
    orange: 'bg-[#FF9500]/[0.15] text-[#C77700] dark:text-[#FF9500]',
    gray: 'bg-black/[0.06] text-muted-foreground dark:bg-white/10 dark:text-zinc-300',
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-medium backdrop-blur-md ${tones[tone]}`}
    >
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      {label}
    </span>
  );
}

/** 次级玻璃胶囊按钮 */
const BTN_GHOST =
  'flex items-center gap-1 rounded-full bg-white/60 px-3.5 py-[7px] text-[11.5px] font-medium text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-md transition-all active:scale-95 disabled:opacity-40 dark:bg-white/10 dark:text-muted-foreground dark:ring-white/10';

// ---------------- 条目胶囊（开关 / 原文浏览 / 编辑 / 恢复默认） ----------------

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
    <div data-testid={`lib-entry-${entry.key}`} className={glassEntry(open, off)}>
      {/* 胶囊头：编号 + 标题 + 状态徽章 + 开关 + 右侧箭头（v68.1 统一：箭头一律靠右，与 App/分类面板一致） */}
      <div className="flex items-center gap-2 px-3 py-[7px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          {entry.n && (
            <span className="shrink-0 rounded-full bg-black/[0.06] px-1.5 py-[1px] font-mono text-[10px] leading-[15px] text-muted-foreground dark:bg-white/10 dark:text-zinc-300">
              {entry.n}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.title}</span>
        </button>
        <span className="flex shrink-0 items-center gap-1">
          {editedText !== undefined && <StatusPill tone="orange" label="已编辑" />}
          <StatusPill
            tone={wired ? 'green' : 'gray'}
            label={wired ? '已接线' : '存档'}
            title={wired ? '已接入运行时：修改与开关即时生效' : '存档条目：编辑与开关先保存，暂未接入运行时链路'}
          />
          <Switch
            checked={!off}
            onCheckedChange={(v) => onToggle(entry.key, v)}
            aria-label={`启用 ${entry.title}`}
            data-testid={`lib-switch-${entry.key}`}
          />
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </div>

      {/* 展开区：触发场景 / 来源 / 原文 / 编辑框 */}
      {open && (
        <div className="border-t border-black/[0.05] px-3 py-3 dark:border-white/10">
          {entry.trigger && (
            <p className="mb-1.5 rounded-[14px] bg-black/[0.04] px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground dark:bg-white/[0.07]">
              <span className="font-medium">触发场景：</span>
              {entry.trigger}
            </p>
          )}
          {entry.file && (
            <p className="mb-1.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground">{entry.file.replace(/`/g, '')}</p>
          )}
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
            原文（一字不差{editedText !== undefined ? '；下方编辑框为当前生效版' : ''}）：
          </p>
          <pre className="thin-scrollbar max-h-56 overflow-y-auto overscroll-contain rounded-[14px] bg-black/[0.045] px-3 py-2 font-mono text-[10.5px] leading-[1.65] break-words whitespace-pre-wrap text-foreground/85 ring-1 ring-black/[0.03] dark:bg-black/25 dark:ring-white/[0.05]">
            {entry.text}
          </pre>
          <Textarea
            value={editing ? (draft as string) : template}
            onChange={(ev) => setDraft(ev.target.value)}
            className={`mt-2 min-h-36 font-mono text-[11px] leading-relaxed ${GLASS_TEXTAREA}`}
            data-testid={`lib-text-${entry.key}`}
          />
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
            编辑版支持 {'{{token}}'} 占位符（原文 ${'{token}'} 自动转换；留空保存 = 恢复默认文本）
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(entry.key, draft ?? '');
                setDraft(null);
              }}
              disabled={!editing}
              className="rounded-full bg-[#007AFF] px-4 py-[7px] text-[11.5px] font-medium text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-40"
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

// ---------------- 主区块 ----------------

export function PresetLibrarySection({ onToast }: { onToast: (m: string) => void }) {
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

  // 当前状态（与上方模块卡同一存储）
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

  // ---- 变更回调（与模块卡共用 prompt-entries-client，写穿 + 服务端同步） ----
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

  /** App 品牌色圆点（分类子面板标题前） */
  const toneOf = (id: string) => (APP_META[id] ?? APP_META.global).tone;

  return (
    <div className="mt-6" data-testid="preset-library-section">
      {/* 区块头：玻璃说明卡 + 统计胶囊 */}
      <div className={GLASS_PANEL}>
        <div className="flex flex-col gap-2.5 px-4 py-4">
          {/* v68.1：flex-wrap + 标题不收缩不折行——窄屏下统计胶囊整组换行到第二行，不再挤压标题/溢出右缘 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#AF52FF] to-[#FF2D55] text-white shadow-[0_4px_12px_rgba(175,82,255,0.4)]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
            </span>
            <p className="shrink-0 whitespace-nowrap text-[14.5px] font-semibold">全量提示词库</p>
            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              {index && <Pill>{index.apps.length} 个 App</Pill>}
              {index && <Pill>{index.total} 条</Pill>}
              {wiredSet.size > 0 && <Pill tone="green">已接线 {wiredSet.size}</Pill>}
            </span>
          </div>
          <p className="text-[11.5px] leading-[1.6] text-muted-foreground">
            系统内发给大模型的全部提示词原文（动作类：买东西、发红包/转账/亲属卡、送礼物、引用、转发、撤回、拍一拍…；生成类：商品、帖子、商家、订单、图片…）。与上方预设模块共用同一套开关/编辑状态；标注「已接线」的条目修改后即时生效，「存档」条目的修改先保存、待接入运行时。
          </p>
        </div>
      </div>

      {/* 搜索胶囊 */}
      <div className="relative mt-3.5 mb-1.5">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索全部提示词（标题 / 正文 / 文件 / 场景）"
          className="h-11 rounded-full border-0 bg-white/60 pl-10 pr-4 text-[13px] shadow-[0_6px_20px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-xl focus-visible:ring-2 focus-visible:ring-[#007AFF]/50 dark:bg-white/[0.08] dark:ring-white/10"
          inputMode="search"
        />
      </div>

      {/* 搜索模式：跨 App 扁平分组结果 */}
      {searchingAll && (
        <div className="mt-2 flex flex-col gap-2.5" data-testid="preset-library-search">
          {searchResults && searchResults.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">没有匹配「{query.trim()}」的提示词</p>
          )}
          {searchResults?.map(({ app, categories }) => (
            <div key={app.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1.5">
                <AppIcon id={app.id} />
                <span className="text-[13px] font-semibold">{app.name}</span>
                <Pill>{categories.reduce((s, c) => s + c.entries.length, 0)} 条命中</Pill>
              </div>
              {categories.map((c, ci) => (
                <div key={`${app.id}-${ci}`} className={GLASS_SUB}>
                  <div className="flex min-h-[40px] items-center gap-2 px-3.5 py-2">
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ backgroundColor: toneOf(app.id) }} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 px-3 pb-3">
                    {c.entries.map(renderEntry)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 浏览模式：App 折叠面板 → 分类折叠 */}
      {!searchingAll && (
        <div className="mt-2 flex flex-col gap-2.5" data-testid="preset-library-apps">
          {index?.apps.map((meta) => {
            const open = openApps.has(meta.id);
            const data = appData[meta.id];
            const loading = loadingApp === meta.id;
            return (
              <div key={meta.id} className={GLASS_PANEL}>
                <button
                  type="button"
                  onClick={() => void toggleApp(meta.id)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                  aria-expanded={open}
                  data-testid={`preset-lib-app-${meta.id}`}
                >
                  <AppIcon id={meta.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{meta.name}</span>
                      <Pill>{meta.count} 条</Pill>
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{meta.desc}</span>
                  </span>
                  <ChevronDown
                    className={`h-[18px] w-[18px] shrink-0 text-muted-foreground/70 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <div className="flex flex-col gap-2 border-t border-black/[0.04] bg-black/[0.03] px-3.5 py-3.5 dark:border-white/[0.06] dark:bg-black/[0.15]">
                    {loading && <p className="px-1 py-2 text-[12px] text-muted-foreground">正在加载…</p>}
                    {!loading && !data && <p className="px-1 py-2 text-[12px] text-red-500">加载失败，请收起后重新展开重试</p>}
                    {data?.categories.map((cat, ci) => {
                      const catKey = `${meta.id}::${ci}`;
                      const catOpen = openCats.has(catKey);
                      return (
                        <div key={catKey} className={GLASS_SUB}>
                          <button
                            type="button"
                            onClick={() => toggleCat(catKey)}
                            className="flex min-h-[44px] w-full items-center gap-2 px-3.5 py-2 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                            aria-expanded={catOpen}
                            data-testid={`preset-lib-cat-${meta.id}-${ci}`}
                          >
                            <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ backgroundColor: toneOf(meta.id) }} />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{cat.name}</span>
                            <Pill>{cat.entries.length}</Pill>
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${catOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {catOpen && (
                            <div className="flex flex-col gap-1.5 border-t border-black/[0.04] px-3 py-2.5 dark:border-white/[0.06]">
                              {cat.entries.map(renderEntry)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 收录口径说明 */}
      <p className="mt-4 px-2 text-[10.5px] leading-relaxed text-muted-foreground/80">
        收录口径：只收真正发给大模型的文本（system / user 消息、规则块、决策与生成提示词、LLM 可见的上下文序列化格式），纯 UI 文案不收录。同一提示词代码块被多个 App 面板收录时（如微信/QQ 共用的聊天规则、淘宝/美团联动的买东西规则），在任一面板关闭即不再注入，编辑以归属 App 面板优先。数据由 scripts/build-prompt-library.ts 构建原文、scripts/build-prompt-wired.ts 扫描源码生成接线清单。
      </p>
    </div>
  );
}

// ---------------- App 图标（胶囊面板内配套） ----------------

function AppIcon({ id }: { id: string }) {
  const meta = APP_META[id] ?? APP_META.global;
  const Icon = meta.icon;
  return (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] shadow-[0_3px_10px_rgba(17,24,39,0.16)] ring-1 ring-white/25"
      style={{ backgroundColor: meta.tone }}
      aria-hidden
    >
      <Icon className="h-4 w-4 text-white" strokeWidth={2.4} />
    </span>
  );
}
