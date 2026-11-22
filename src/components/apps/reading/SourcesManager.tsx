'use client';

/**
 * 书源管理器（Legado 风格重设计 · 用户截图同款）：
 * - 顶栏：返回 + 标题 + [分组] [多选] 文字钮 + [校验] 胶囊 + 蓝色圆形「+」
 * - 搜索框：全圆角胶囊「搜索书源名称 / 分组 / 网址」
 * - 筛选 chips：全部/已启用/已停用 · 分组chips（分组按钮展开）+ 底部「共N个 · N启用」
 * - 列表：白色大圆角卡片（图标 + 名称 + 绿色「可用」标签 + 分组·网址 + ⋮菜单 + iOS开关）
 * - 多选模式：勾选 + 批量启用/停用/删除
 * - 长按非内置源 → 删除确认；⋮菜单：校验/置顶/复制链接/删除
 * - 校验（一键筛活）：分批实测 → 失败自动停用 → 可用排前
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  RefreshCw,
  RotateCcw,
  ClipboardPaste,
  Link2,
  FileUp,
  Loader2,
  X,
  Zap,
  Trash2,
  Search,
  MoreVertical,
  Check,
  ArrowUpToLine,
  Copy,
  CircleCheck,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { localSizeOf, viewportToLocal } from '@/lib/ios/shell-scale';
import { api, themeOf, type SourceItem } from './shared';
import { SubNavBar } from './ReadingApp';

/** 预置书源合集（本地文件秒导入） */
const PRESETS: { name: string; file: string; desc: string }[] = [
  { name: 'XIU2 精选书源（22 源）', file: 'xiu2.json', desc: '起点/番茄/69书吧 等精选，导入快' },
  { name: '破冰书源（128 源）', file: 'pobing.json', desc: '精品/API/正版/有声' },
  { name: 'Yiove 书源合集（714 源）', file: 'yiove.json', desc: '酷安聚合；量大默认停用，校验后自动启用可用源' },
];

/** 图标柔和配色（按名称哈希取色：浅底 + 深字） */
const ICON_PALETTE = [
  { bg: '#E8F0FE', fg: '#3D7EFF' },
  { bg: '#E6F6EC', fg: '#26A65B' },
  { bg: '#FFF4DE', fg: '#E8A23C' },
  { bg: '#F0EAFB', fg: '#8B5CF6' },
  { bg: '#FDEAF2', fg: '#EC5E9C' },
  { bg: '#E3F5F5', fg: '#13A3A3' },
];
function iconColorOf(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[h % ICON_PALETTE.length];
}
function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}
function groupFirst(group: string) {
  return (group || '').split(/[;；,，]/)[0].trim();
}

type FilterKey = 'all' | 'enabled' | 'disabled';

export function SourcesManager({ onBack }: { onBack: () => void }) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const loadSources = useReading((s) => s.loadSources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const dark = settings.appTheme === 'midnight';
  /** 页面容器（⋮ 菜单定位坐标系） */
  const rootRef = useRef<HTMLDivElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(true);
  const [kw, setKw] = useState('');

  /** 多选模式 */
  const [multiMode, setMultiMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** ⋮ 菜单（单例浮层：按钮位置 + 容器相对坐标，边界内钳制不溢出屏幕） */
  const [menuFor, setMenuFor] = useState<{ src: SourceItem; left: number; top: number; rootW: number; rootH: number } | null>(null);

  /** 校验进行态 */
  const [smartRun, setSmartRun] = useState(false);
  const [smartDone, setSmartDone] = useState(0);
  const [smartTotal, setSmartTotal] = useState(0);
  const smartCancelRef = useRef(false);

  /** 长按删除非内置源 */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDel, setConfirmDel] = useState<SourceItem | null>(null);

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2400);
  };

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const enabledCount = sources.filter((s) => s.enabled).length;
  /** 实测失败且已停用的非内置源（「清理失效」目标） */
  const failedCount = sources.filter((s) => s.checkStatus === 'fail' && !s.enabled && !s.isBuiltin).length;
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sources) {
      const g = groupFirst(s.group) || '未分组';
      m.set(g, (m.get(g) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [sources]);

  const list = useMemo(() => {
    let l = sources;
    if (filter === 'enabled') l = l.filter((s) => s.enabled);
    else if (filter === 'disabled') l = l.filter((s) => !s.enabled);
    if (groupFilter) {
      l = l.filter((s) => (groupFirst(s.group) || '未分组') === groupFilter || (!s.group && groupFilter === '未分组'));
    }
    const k = kw.trim().toLowerCase();
    if (k) {
      l = l.filter(
        (s) => s.name.toLowerCase().includes(k) || s.url.toLowerCase().includes(k) || (s.group || '').toLowerCase().includes(k),
      );
    }
    return l;
  }, [sources, filter, groupFilter, kw]);

  const doImport = async (body: Record<string, unknown>) => {
    setImporting(true);
    try {
      const r = (await api.sourceAction(body)) as { imported?: number; skipped?: number; error?: string };
      if (r.error) notify(r.error);
      else {
        notify(`导入 ${r.imported || 0} 个源（跳过 ${r.skipped || 0}）`);
        setJsonText('');
        setUrlText('');
        setAddOpen(false);
        await loadSources();
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : '导入失败');
    }
    setImporting(false);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      await doImport({ action: 'importJson', json: text });
    } catch {
      notify('文件读取失败');
    }
  };

  const toggleSource = async (s: SourceItem, on?: boolean) => {
    await api.sourceAction({ action: 'toggle', id: s.id, enabled: on ?? !s.enabled }).catch(() => null);
    await loadSources();
  };

  const smartCheck = async () => {
    if (smartRun) return;
    const targets = sources.filter((s) => s.enabled || s.checkStatus !== 'ok');
    if (!targets.length) {
      notify('没有需要校验的书源');
      return;
    }
    smartCancelRef.current = false;
    setSmartRun(true);
    setSmartTotal(targets.length);
    setSmartDone(0);
    let ok = 0;
    let fail = 0;
    const BATCH = 25;
    for (let i = 0; i < targets.length; i += BATCH) {
      if (smartCancelRef.current) break;
      const batch = targets.slice(i, i + BATCH).map((s) => s.id);
      try {
        const r = (await api.sourceAction({ action: 'checkBatch', ids: batch, autoDisable: true })) as {
          results?: { ok: boolean }[];
        };
        for (const x of r.results || []) {
          if (x.ok) ok++;
          else fail++;
        }
      } catch {
        fail += batch.length;
      }
      setSmartDone(Math.min(i + BATCH, targets.length));
    }
    try {
      await api.sourceAction({ action: 'sortUsable' });
    } catch {
      /* 忽略 */
    }
    await loadSources();
    setSmartRun(false);
    notify(smartCancelRef.current ? '已中止校验' : `校验完成：可用 ${ok} 个，已自动停用 ${fail} 个失效源`);
  };

  const pinTop = async (s: SourceItem) => {
    const ids = [s.id, ...sources.filter((x) => x.id !== s.id).map((x) => x.id)];
    await api.sourceAction({ action: 'sort', ids }).catch(() => null);
    await loadSources();
    notify(`「${s.name}」已置顶`);
  };

  const copyLink = async (s: SourceItem) => {
    try {
      await navigator.clipboard.writeText(s.url);
      notify('书源地址已复制');
    } catch {
      notify('复制失败');
    }
  };

  const batchAction = async (action: 'enable' | 'disable' | 'delete') => {
    const ids = [...selected];
    if (!ids.length) {
      notify('还没有勾选书源');
      return;
    }
    if (action === 'delete') {
      for (const id of ids) {
        const s = sources.find((x) => x.id === id);
        if (s?.isBuiltin) continue; // 内置源不删（可停用）
        await api.sourceAction({ action: 'delete', id }).catch(() => null);
      }
      notify('已删除所选（内置源保留）');
    } else {
      for (const id of ids) {
        await api.sourceAction({ action: 'toggle', id, enabled: action === 'enable' }).catch(() => null);
      }
      notify(action === 'enable' ? '已启用所选书源' : '已停用所选书源');
    }
    setSelected(new Set());
    setMultiMode(false);
    await loadSources();
  };

  /** 一键清理失效源（实测失败 + 已停用 + 非内置；用户内置源不受影响） */
  const [cleaning, setCleaning] = useState(false);
  const cleanFailed = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const r = (await api.sourceAction({ action: 'deleteFailed' })) as { deleted?: number };
      await loadSources();
      notify(`已清理 ${r.deleted || 0} 个失效书源`);
    } catch {
      notify('清理失败，请重试');
    }
    setCleaning(false);
  };

  // ------------------------------------------------------------------
  // 皮肤（截图1为浅色：浅灰页面底 + 白卡片；深色主题用等价深色）
  // ------------------------------------------------------------------
  const pageBg = dark ? '#12141C' : '#F2F3F7';
  const cardBg = dark ? 'rgba(30,33,46,0.92)' : '#FFFFFF';
  const cardRing = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const chipBg = dark ? 'rgba(255,255,255,0.07)' : '#FFFFFF';
  const chipRing = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const BLUE = '#3D7EFF';
  const blueSoft = dark ? 'rgba(91,141,239,0.18)' : '#E8F0FE';

  const renderRight = () =>
    multiMode ? (
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(list.length === selected.size ? new Set() : new Set(list.map((s) => s.id)))}
          className="whitespace-nowrap text-[13px] font-medium"
          style={{ color: BLUE }}
        >
          {list.length && list.length === selected.size ? '取消全选' : '全选'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMultiMode(false);
            setSelected(new Set());
          }}
          className="whitespace-nowrap text-[13px] font-medium"
          style={{ color: theme.textSub }}
        >
          取消
        </button>
      </div>
    ) : (
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setMultiMode(true)}
          className="whitespace-nowrap text-[13px] font-medium active:scale-95"
          style={{ color: BLUE }}
        >
          多选
        </button>
        <button
          type="button"
          onClick={() => void smartCheck()}
          disabled={smartRun}
          className="flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-semibold active:scale-95 disabled:opacity-60"
          style={{ background: blueSoft, color: BLUE }}
        >
          {smartRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {smartRun ? `${smartDone}/${smartTotal}` : '校验'}
        </button>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          aria-label="添加书源"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-md active:scale-90"
          style={{ background: BLUE, boxShadow: `0 4px 10px ${BLUE}55` }}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </button>
      </div>
    );

  return (
    <div ref={rootRef} className="relative flex h-full flex-col overflow-hidden" style={{ background: pageBg }}>
      <SubNavBar
        title={multiMode ? `已选 ${selected.size} 项` : '书源管理'}
        onBack={() => {
          if (multiMode) {
            setMultiMode(false);
            setSelected(new Set());
          } else onBack();
        }}
        theme={theme}
        right={renderRight()}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-28 [scrollbar-width:thin]">
        {/* 校验进度条 */}
        {smartRun && (
          <div className="mt-2 rounded-2xl p-3.5" style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: theme.textMain }}>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: BLUE }} />
                正在逐源实测（{smartDone}/{smartTotal}）
              </p>
              <button
                type="button"
                onClick={() => {
                  smartCancelRef.current = true;
                }}
                className="text-[12px] font-medium"
                style={{ color: '#E05252' }}
              >
                中止
              </button>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${smartTotal ? Math.round((smartDone / smartTotal) * 100) : 0}%`, background: BLUE }}
              />
            </div>
          </div>
        )}

        {/* 搜索框 */}
        <div className="mt-3 flex h-11 items-center gap-2 rounded-full px-4" style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}>
          <Search className="h-[17px] w-[17px] shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索书源名称 / 分组 / 网址"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: theme.textMain }}
            aria-label="搜索书源"
          />
          {kw && (
            <button type="button" onClick={() => setKw('')} aria-label="清空" style={{ color: theme.textSub }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 筛选 chips（含分组开关 + 清理失效入口；全部单行不换行） */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              { k: 'all' as FilterKey, label: `全部 ${sources.length}` },
              { k: 'enabled' as FilterKey, label: `已启用 ${enabledCount}` },
              { k: 'disabled' as FilterKey, label: `已停用 ${sources.length - enabledCount}` },
            ]
          ).map((f) => (
            <button
              key={f.k}
              type="button"
              onClick={() => setFilter(f.k)}
              className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-medium transition-all active:scale-95"
              style={
                filter === f.k
                  ? { background: BLUE, color: '#fff' }
                  : { background: chipBg, color: theme.textMain, boxShadow: `inset 0 0 0 1px ${chipRing}` }
              }
            >
              {f.label}
            </button>
          ))}
          {/* 分组开关（从顶栏移到筛选行，解决顶栏拥挤） */}
          <button
            type="button"
            onClick={() => {
              setShowGroups((v) => !v);
              if (!showGroups) setGroupFilter(null);
            }}
            className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-medium transition-all active:scale-95"
            style={
              showGroups
                ? { background: blueSoft, color: BLUE, fontWeight: 600 }
                : { background: chipBg, color: theme.textMain, boxShadow: `inset 0 0 0 1px ${chipRing}` }
            }
          >
            分组 {showGroups ? '▴' : '▾'}
          </button>
          {/* 清理失效源（实测失败 + 已停用才计数；一键删除非内置死源） */}
          {failedCount > 0 && !multiMode && (
            <button
              type="button"
              onClick={() => void cleanFailed()}
              disabled={cleaning}
              className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-semibold transition-all active:scale-95 disabled:opacity-60"
              style={{ background: '#FDEBEB', color: '#E05252' }}
            >
              {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              清理失效 {failedCount}
            </button>
          )}
          {showGroups && (
            <button
              type="button"
              onClick={() => setGroupFilter(null)}
              className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-medium transition-all active:scale-95"
              style={
                !groupFilter
                  ? { background: BLUE, color: '#fff' }
                  : { background: chipBg, color: theme.textMain, boxShadow: `inset 0 0 0 1px ${chipRing}` }
              }
            >
              全部分组
            </button>
          )}
          {showGroups &&
            groups.map(([g, n]) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupFilter(groupFilter === g ? null : g)}
                className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-medium transition-all active:scale-95"
                style={
                  groupFilter === g
                    ? { background: BLUE, color: '#fff' }
                    : { background: chipBg, color: theme.textMain, boxShadow: `inset 0 0 0 1px ${chipRing}` }
                }
              >
                {g} {n}
              </button>
            ))}
        </div>

        {/* 统计行 */}
        <div className="mt-2 flex items-center justify-between px-1.5">
          <p className="text-[11.5px]" style={{ color: theme.textSub }}>
            共 {list.length} 个{groupFilter ? ` · ${groupFilter}` : ''}
          </p>
          <p className="text-[11.5px]" style={{ color: theme.textSub }}>
            {list.filter((s) => s.enabled).length} 启用
          </p>
        </div>

        {/* 书源卡片列表 */}
        <div className="mt-2 space-y-2">
          {list.slice(0, 300).map((s) => {
            const ic = iconColorOf(s.name);
            const g = groupFirst(s.group) || '未分组';
            const checked = selected.has(s.id);
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-[16px] px-3.5 py-3 active:scale-[0.995]"
                style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}
                onTouchStart={() => {
                  if (!s.isBuiltin && !multiMode) {
                    pressTimer.current = setTimeout(() => {
                      pressTimer.current = null;
                      setConfirmDel(s);
                    }, 550);
                  }
                }}
                onTouchEnd={() => {
                  if (pressTimer.current) {
                    clearTimeout(pressTimer.current);
                    pressTimer.current = null;
                  }
                }}
                onTouchMove={() => {
                  if (pressTimer.current) {
                    clearTimeout(pressTimer.current);
                    pressTimer.current = null;
                  }
                }}
                onContextMenu={(e) => {
                  if (!s.isBuiltin && !multiMode) {
                    e.preventDefault();
                    setConfirmDel(s);
                  }
                }}
              >
                {/* 勾选框（多选模式）或图标 */}
                {multiMode ? (
                  <button
                    type="button"
                    aria-label={checked ? '取消选择' : '选择'}
                    onClick={() =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                    style={checked ? { background: BLUE, borderColor: BLUE } : { borderColor: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)' }}
                  >
                    {checked && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                  </button>
                ) : (
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-[16px] font-bold"
                    style={{ background: ic.bg, color: ic.fg }}
                    aria-hidden="true"
                  >
                    {s.name.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '').slice(0, 1) || '书'}
                  </span>
                )}
                {/* 名称 + 状态行 */}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    if (multiMode) {
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      });
                    }
                  }}
                >
                  <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
                    {s.name}
                  </p>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5">
                    {s.checkStatus === 'fail' ? (
                      <span
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-medium"
                        style={{ background: '#FDEBEB', color: '#E05252' }}
                      >
                        失效
                      </span>
                    ) : s.enabled ? (
                      <span
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-medium"
                        style={{ background: '#E9F7EF', color: '#0FA958' }}
                      >
                        <span className="h-1 w-1 rounded-full" style={{ background: '#0FA958' }} />
                        可用
                      </span>
                    ) : (
                      <span
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-medium"
                        style={{ background: dark ? 'rgba(255,255,255,0.08)' : '#F1F2F4', color: theme.textSub }}
                      >
                        停用
                      </span>
                    )}
                    <span className="min-w-0 truncate text-[11px]" style={{ color: theme.textSub }}>
                      {g} · {hostOf(s.url)}
                    </span>
                  </p>
                </button>
                {/* ⋮ 菜单 + 开关 */}
                {!multiMode && (
                  <>
                    <button
                      type="button"
                      aria-label="更多操作"
                      className="flex h-9 w-7 shrink-0 items-center justify-center rounded-full active:scale-90"
                      style={{ color: theme.textSub }}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const root = rootRef.current?.getBoundingClientRect();
                        if (!root) return;
                        // 视口坐标 → 页面内部坐标（横屏旋转/缩放兼容）
                        const p = viewportToLocal(r.right, r.bottom, root);
                        const sz = localSizeOf(root);
                        setMenuFor({ src: s, left: p.x, top: p.y, rootW: sz.w, rootH: sz.h });
                      }}
                    >
                      <MoreVertical className="h-[18px] w-[18px]" />
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      aria-label={s.enabled ? '停用' : '启用'}
                      onClick={() => void toggleSource(s)}
                      className={`flex h-[26px] w-[44px] shrink-0 items-center rounded-full px-0.5 transition-colors ${s.enabled ? 'justify-end' : 'justify-start'}`}
                      style={s.enabled ? { background: BLUE } : { background: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' }}
                    >
                      <span className="h-[22px] w-[22px] rounded-full bg-white shadow" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {list.length > 300 && (
            <p className="py-3 text-center text-[11px]" style={{ color: theme.textSub }}>
              还有 {list.length - 300} 个未显示，用搜索定位书源
            </p>
          )}
          {list.length === 0 && (
            <p className="py-12 text-center text-[13px]" style={{ color: theme.textSub }}>
              没有匹配的书源
            </p>
          )}
        </div>
      </div>

      {/* 多选模式底部操作栏 */}
      {multiMode && (
        <div
          className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-full px-3 py-2.5 shadow-xl"
          style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}, 0 8px 24px rgba(0,0,0,0.18)` }}
        >
          <button
            type="button"
            onClick={() => void batchAction('enable')}
            className="h-9 flex-1 rounded-full text-[13px] font-semibold active:scale-95"
            style={{ background: blueSoft, color: BLUE }}
          >
            启用
          </button>
          <button
            type="button"
            onClick={() => void batchAction('disable')}
            className="h-9 flex-1 rounded-full text-[13px] font-medium active:scale-95"
            style={{ background: dark ? 'rgba(255,255,255,0.08)' : '#F1F2F4', color: theme.textMain }}
          >
            停用
          </button>
          <button
            type="button"
            onClick={() => void batchAction('delete')}
            className="h-9 flex-1 rounded-full text-[13px] font-semibold text-white active:scale-95"
            style={{ background: '#E05252' }}
          >
            删除
          </button>
        </div>
      )}

      {/* ⋮ 菜单浮层（容器相对坐标 + 边界钩制：右对齐按钮、底部不够放时改向上弹出；轻遮罩突出层次） */}
      {menuFor && (
        <div className="absolute inset-0 z-40 bg-black/15" role="menu" aria-label="书源操作" onClick={() => setMenuFor(null)}>
          {(() => {
            const W = 152;
            const estH = 186;
            const left = Math.max(8, Math.min(menuFor.left - W + 24, menuFor.rootW - W - 8));
            const below = menuFor.top + estH + 8 < menuFor.rootH;
            const top = below ? menuFor.top + 6 : Math.max(8, menuFor.top - estH - 24);
            return (
              <div
                className="absolute w-38 overflow-hidden rounded-2xl py-1 shadow-2xl"
                style={{
                  left,
                  top,
                  width: W,
                  background: cardBg,
                  boxShadow: `inset 0 0 0 1px ${cardRing}, 0 12px 36px rgba(0,0,0,0.22)`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
            {[
              {
                key: 'check',
                label: menuFor.src.checkStatus === 'ok' ? '重新校验' : '校验此源',
                icon: <CircleCheck className="h-[17px] w-[17px]" style={{ color: BLUE }} />,
                run: async () => {
                  notify(`正在实测「${menuFor.src.name}」…`);
                  const r = (await api.sourceAction({ action: 'check', id: menuFor.src.id }).catch(() => null)) as { ok?: boolean } | null;
                  await loadSources();
                  notify(r?.ok ? `「${menuFor.src.name}」可用 ✓` : `「${menuFor.src.name}」失效 ✗`);
                },
              },
              {
                key: 'pin',
                label: '置顶',
                icon: <ArrowUpToLine className="h-[17px] w-[17px]" style={{ color: BLUE }} />,
                run: () => void pinTop(menuFor.src),
              },
              {
                key: 'copy',
                label: '复制链接',
                icon: <Copy className="h-[17px] w-[17px]" style={{ color: BLUE }} />,
                run: () => void copyLink(menuFor.src),
              },
              ...(menuFor.src.isBuiltin
                ? [
                    {
                      key: 'toggle',
                      label: menuFor.src.enabled ? '停用此源' : '启用此源',
                      icon: <RefreshCw className="h-[17px] w-[17px]" style={{ color: BLUE }} />,
                      run: () => void toggleSource(menuFor.src),
                    },
                  ]
                : [
                    {
                      key: 'del',
                      label: '删除此源',
                      icon: <Trash2 className="h-[17px] w-[17px]" style={{ color: '#E05252' }} />,
                      run: () => setConfirmDel(menuFor.src),
                    },
                  ]),
            ].map((it) => (
              <button
                key={it.key}
                type="button"
                className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2.5 text-left text-[13.5px] font-medium active:opacity-60"
                style={{ color: it.key === 'del' ? '#E05252' : theme.textMain }}
                onClick={() => {
                  setMenuFor(null);
                  void it.run();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* 添加书源抽屉 */}
      {addOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="添加书源">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35" onClick={() => setAddOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto overscroll-contain rounded-t-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl"
            style={{ background: pageBg, boxShadow: `inset 0 0 0 1px ${cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                添加书源
              </p>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
              >
                <X className="h-4 w-4" style={{ color: theme.textMain }} />
              </button>
            </div>

            {/* 粘贴 JSON */}
            <div className="rounded-2xl p-3.5" style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <ClipboardPaste className="h-4 w-4" /> 粘贴书源 JSON
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder="粘贴阅读 3.0 书源（单个对象或数组都支持）…"
                className="h-24 w-full resize-none rounded-xl p-3 text-[12px] outline-none"
                style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: theme.textMain }}
              />
              <button
                type="button"
                disabled={!jsonText.trim() || importing}
                onClick={() => void doImport({ action: 'importJson', json: jsonText })}
                className="mt-2 h-10 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40"
                style={{ background: BLUE }}
              >
                {importing ? '导入中…' : '导入'}
              </button>
            </div>

            {/* URL 导入 */}
            <div className="mt-3 rounded-2xl p-3.5" style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <Link2 className="h-4 w-4" /> 从链接导入
              </p>
              <input
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                placeholder="https://…/shuyuan.json"
                className="h-10 w-full rounded-xl px-3 text-[12px] outline-none"
                style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: theme.textMain }}
              />
              <button
                type="button"
                disabled={!urlText.trim() || importing}
                onClick={() => void doImport({ action: 'importUrl', url: urlText })}
                className="mt-2 h-10 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40"
                style={{ background: BLUE }}
              >
                {importing ? '拉取中…' : '导入'}
              </button>
              {/* 预置合集 */}
              <p className="mb-1.5 mt-3 text-[11px]" style={{ color: theme.textSub }}>
                热门免费书源合集（本地秒导入；大合集默认停用，导入后点「校验」自动启用可用源）
              </p>
              <div className="space-y-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.file}
                    type="button"
                    disabled={importing}
                    onClick={() => void doImport({ action: 'importLocal', file: p.file })}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left active:scale-[0.99] disabled:opacity-50"
                    style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                  >
                    <span>
                      <span className="block text-[13px] font-medium" style={{ color: theme.textMain }}>
                        {p.name}
                      </span>
                      <span className="block text-[11px]" style={{ color: theme.textSub }}>
                        {p.desc}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0" style={{ color: BLUE }} />
                  </button>
                ))}
              </div>
            </div>

            {/* 文件上传 */}
            <div className="mt-3 rounded-2xl p-3.5" style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <FileUp className="h-4 w-4" /> 从手机上传书源文件
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-11 w-full rounded-xl border-2 border-dashed text-[13px] font-medium active:scale-[0.99]"
                style={{ borderColor: `${BLUE}55`, color: BLUE }}
              >
                选择 .json 书源文件
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>

            {/* 恢复内置 */}
            <button
              type="button"
              onClick={async () => {
                await api.sourceAction({ action: 'resetBuiltin' }).catch(() => null);
                await loadSources();
                notify('内置书源已恢复');
              }}
              className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-medium active:scale-95"
              style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.045)', color: theme.textMain }}
            >
              <RotateCcw className="h-4 w-4" /> 恢复全部内置书源
            </button>
          </div>
        </div>
      )}

      {/* 删除确认（长按非内置源） */}
      {confirmDel && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="删除书源确认">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            onClick={() => setConfirmDel(null)}
          />
          <div
            className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl p-5 text-center shadow-2xl"
            style={{ background: cardBg, boxShadow: `inset 0 0 0 1px ${cardRing}` }}
          >
            <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
              删除书源「{confirmDel.name}」？
            </p>
            <p className="mt-1 text-[12px]" style={{ color: theme.textSub }}>
              只删这一个源；书架和阅读历史不受影响
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDel(null)}
                className="h-10 flex-1 rounded-full text-[14px] font-medium active:scale-95"
                style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', color: theme.textMain }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  await api.sourceAction({ action: 'delete', id: confirmDel.id }).catch(() => null);
                  setConfirmDel(null);
                  await loadSources();
                  notify('已删除');
                }}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold text-white active:scale-95"
                style={{ background: '#E05252' }}
              >
                <Trash2 className="h-4 w-4" /> 删除
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-6">
          <span className="rounded-full bg-black/75 px-4 py-2 text-center text-[13px] text-white backdrop-blur">{toast}</span>
        </div>
      )}
    </div>
  );
}
