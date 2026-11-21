'use client';

/**
 * 书源管理器：
 * - 一键筛活：分批实测全部书源 → 失败自动停用 → 可用排前（解决"几百个源能用十几个"）
 * - 筛选：全部 / 已启用 / 可用 / 失效；搜索书源名
 * - 列表：启停开关 / 健康状态徽标 / 长按删除非内置源
 * - 添加书源：粘贴 JSON / 合集 URL 一键导入 / 手机上传文件（.json）
 * - 预置合集直链（本地文件秒导入）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  RefreshCw,
  RotateCcw,
  ClipboardPaste,
  Link2,
  FileUp,
  CircleCheck,
  CircleX,
  Loader2,
  X,
  Zap,
  Trash2,
  Search,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { api, themeOf, type SourceItem } from './shared';
import { SubNavBar } from './ReadingApp';

/** 预置书源合集：本地文件（public/reading-sources/，随代码分发，秒导入不受外网波动影响） */
const PRESETS: { name: string; file: string; desc: string }[] = [
  {
    name: 'XIU2 精选书源（22 源）',
    file: 'xiu2.json',
    desc: '起点/番茄/69书吧 等精选，导入快',
  },
  {
    name: '破冰书源（128 源）',
    file: 'pobing.json',
    desc: '精品/API/正版/有声',
  },
  {
    name: 'Yiove 书源合集（714 源）',
    file: 'yiove.json',
    desc: '酷安聚合；量大默认停用，筛活后自动启用可用源',
  },
];

/** 筛选维度 */
type FilterKey = 'all' | 'enabled' | 'ok' | 'fail';

export function SourcesManager({ onBack }: { onBack: () => void }) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const loadSources = useReading((s) => s.loadSources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 筛选 + 搜索 */
  const [filter, setFilter] = useState<FilterKey>('all');
  const [kw, setKw] = useState('');

  /** 一键筛活：分批实测（25 源/批）→ 失败自动停用 → 可用排前 */
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

  // 打开即刷新（拿最新的启停/检查状态，避免读到旧缓存）
  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const enabledCount = sources.filter((s) => s.enabled).length;
  const okCount = sources.filter((s) => s.checkStatus === 'ok').length;
  const failCount = sources.filter((s) => s.checkStatus === 'fail').length;

  const list = useMemo(() => {
    let l = sources;
    if (filter === 'enabled') l = l.filter((s) => s.enabled);
    else if (filter === 'ok') l = l.filter((s) => s.checkStatus === 'ok');
    else if (filter === 'fail') l = l.filter((s) => s.checkStatus === 'fail');
    const k = kw.trim().toLowerCase();
    if (k) l = l.filter((s) => s.name.toLowerCase().includes(k) || s.url.toLowerCase().includes(k));
    return l;
  }, [sources, filter, kw]);

  const smartCheck = async () => {
    if (smartRun) return;
    const targets = sources.filter((s) => s.enabled || s.checkStatus !== 'ok');
    if (!targets.length) {
      notify('没有需要检查的书源');
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
    // 可用排前 + 刷新列表
    try {
      await api.sourceAction({ action: 'sortUsable' });
    } catch {
      /* 忽略 */
    }
    await loadSources();
    setSmartRun(false);
    notify(smartCancelRef.current ? '已中止筛活' : `筛活完成：可用 ${ok} 个，已自动停用 ${fail} 个失效源`);
  };

  const resetBuiltin = async () => {
    await api.sourceAction({ action: 'resetBuiltin' }).catch(() => null);
    await loadSources();
    notify('内置书源已恢复');
  };

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

  const card = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;
  const sheetStyle = { background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` } as const;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar
        title="书源管理"
        onBack={onBack}
        theme={theme}
        right={
          <button
            type="button"
            onClick={() => void smartCheck()}
            disabled={smartRun}
            aria-label="一键筛活"
            className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold active:scale-90 ${smartRun ? 'text-white' : ''}`}
            style={
              smartRun
                ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }
                : { color: theme.accent }
            }
          >
            {smartRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {smartRun ? `${smartDone}/${smartTotal}` : '筛活'}
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
        {/* 添加按钮区 */}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-white shadow-lg active:scale-95"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 6px 18px ${theme.accent}44` }}
          >
            <Plus className="h-[18px] w-[18px]" /> 添加书源
          </button>
          <button
            type="button"
            onClick={() => void smartCheck()}
            disabled={smartRun}
            aria-label="一键筛活"
            className="flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold backdrop-blur-xl active:scale-95 disabled:opacity-50"
            style={{ ...card, color: theme.accent }}
          >
            {smartRun ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Zap className="h-[18px] w-[18px]" />}
            一键筛活
          </button>
          <button
            type="button"
            onClick={() => void resetBuiltin()}
            aria-label="恢复内置"
            className="flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ ...card, color: theme.textMain }}
          >
            <RotateCcw className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* 筛活进度条 */}
        {smartRun && (
          <div className="mt-3 rounded-2xl p-3.5 backdrop-blur-xl" style={card}>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: theme.textMain }}>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
                正在逐源实测搜索（{smartDone}/{smartTotal}）
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
            <p className="mt-1 text-[11px]" style={{ color: theme.textSub }}>
              失效书源会自动停用，可用书源排到最前
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${smartTotal ? Math.round((smartDone / smartTotal) * 100) : 0}%`,
                  background: `linear-gradient(90deg, ${theme.gradFrom}, ${theme.gradTo})`,
                }}
              />
            </div>
          </div>
        )}

        {/* 统计胶囊 */}
        <div className="mt-4 flex gap-2.5">
          {[
            { n: sources.length, label: '书源总数' },
            { n: enabledCount, label: '已启用' },
            { n: okCount, label: '实测可用' },
          ].map((s2) => (
            <div key={s2.label} className="flex-1 rounded-2xl py-2.5 text-center backdrop-blur-xl" style={card}>
              <p className="text-[19px] font-bold tabular-nums" style={{ color: theme.accent }}>
                {s2.n}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
                {s2.label}
              </p>
            </div>
          ))}
        </div>

        {/* 筛选 + 搜索行 */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex gap-1.5">
            {(
              [
                { k: 'all' as FilterKey, label: `全部 ${sources.length}` },
                { k: 'enabled' as FilterKey, label: `启用 ${enabledCount}` },
                { k: 'ok' as FilterKey, label: `可用 ${okCount}` },
                { k: 'fail' as FilterKey, label: `失效 ${failCount}` },
              ]
            ).map((f) => (
              <button
                key={f.k}
                type="button"
                onClick={() => setFilter(f.k)}
                className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-medium backdrop-blur-xl active:scale-95 ${filter === f.k ? 'text-white' : ''}`}
                style={
                  filter === f.k
                    ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }
                    : { ...card, color: theme.textMain }
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 backdrop-blur-xl" style={card}>
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜书源名"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: theme.textMain }}
              aria-label="搜索书源"
            />
            {kw && (
              <button type="button" onClick={() => setKw('')} aria-label="清空" style={{ color: theme.textSub }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 书源列表 */}
        <div className="mt-3 overflow-hidden rounded-3xl" style={card}>
          {list.slice(0, 400).map((s, i) => (
            <div key={s.id}>
              {i > 0 && <div className="ml-[68px] h-px" style={{ background: theme.cardRing }} />}
              <div
                className="flex items-center gap-3 px-4 py-3"
                onTouchStart={() => {
                  if (!s.isBuiltin) {
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
                  if (!s.isBuiltin) {
                    e.preventDefault();
                    setConfirmDel(s);
                  }
                }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold"
                  style={{ background: theme.accentSoft, color: theme.accent }}
                >
                  {s.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                    {s.name}
                    {s.isBuiltin && (
                      <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                        内置
                      </span>
                    )}
                    {s.checkStatus === 'ok' && <CircleCheck className="h-3.5 w-3.5 shrink-0 text-[#10B981]" />}
                    {s.checkStatus === 'fail' && <CircleX className="h-3.5 w-3.5 shrink-0 text-[#E05252]" />}
                  </p>
                  <p className="mt-0.5 truncate text-[11px]" style={{ color: theme.textSub }}>
                    {s.url.replace(/^https?:\/\//, '')}
                  </p>
                </div>
                {/* 启停开关 */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label={s.enabled ? '停用' : '启用'}
                  onClick={async () => {
                    await api.sourceAction({ action: 'toggle', id: s.id, enabled: !s.enabled }).catch(() => null);
                    await loadSources();
                  }}
                  className={`flex h-[26px] w-[44px] shrink-0 items-center rounded-full px-0.5 transition-colors ${s.enabled ? 'justify-end' : 'justify-start bg-black/[0.12]'}`}
                  style={s.enabled ? { background: theme.accent } : undefined}
                >
                  <span className="h-[22px] w-[22px] rounded-full bg-white shadow" />
                </button>
              </div>
            </div>
          ))}
          {list.length > 400 && (
            <p className="py-3 text-center text-[11px]" style={{ color: theme.textSub }}>
              仅显示前 400 个，用搜索定位书源
            </p>
          )}
          {list.length === 0 && (
            <p className="py-10 text-center text-[13px]" style={{ color: theme.textSub }}>
              没有匹配的书源
            </p>
          )}
        </div>
      </div>

      {/* 添加书源抽屉 */}
      {addOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="添加书源">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35" onClick={() => setAddOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto overscroll-contain rounded-t-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl" style={sheetStyle}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                添加书源
              </p>
              <button type="button" onClick={() => setAddOpen(false)} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05]">
                <X className="h-4 w-4" style={{ color: theme.textMain }} />
              </button>
            </div>

            {/* 粘贴 JSON */}
            <div className="rounded-2xl p-3.5" style={card}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <ClipboardPaste className="h-4 w-4" /> 粘贴书源 JSON
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder='粘贴阅读 3.0 书源（单个对象或数组都支持）…'
                className="h-24 w-full resize-none rounded-xl bg-black/[0.04] p-3 text-[12px] outline-none"
                style={{ color: theme.textMain }}
              />
              <button
                type="button"
                disabled={!jsonText.trim() || importing}
                onClick={() => void doImport({ action: 'importJson', json: jsonText })}
                className="mt-2 h-10 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
              >
                {importing ? '导入中…' : '导入'}
              </button>
            </div>

            {/* URL 导入 */}
            <div className="mt-3 rounded-2xl p-3.5" style={card}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <Link2 className="h-4 w-4" /> 从链接导入
              </p>
              <input
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                placeholder="https://…/shuyuan.json"
                className="h-10 w-full rounded-xl bg-black/[0.04] px-3 text-[12px] outline-none"
                style={{ color: theme.textMain }}
              />
              <button
                type="button"
                disabled={!urlText.trim() || importing}
                onClick={() => void doImport({ action: 'importUrl', url: urlText })}
                className="mt-2 h-10 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
              >
                {importing ? '拉取中…' : '导入'}
              </button>
              {/* 预置合集（本地文件，秒导入） */}
              <p className="mb-1.5 mt-3 text-[11px]" style={{ color: theme.textSub }}>
                热门免费书源合集（本地秒导入；大合集默认停用，导入后点「筛活」自动启用可用源）
              </p>
              <div className="space-y-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.file}
                    type="button"
                    disabled={importing}
                    onClick={() => void doImport({ action: 'importLocal', file: p.file })}
                    className="flex w-full items-center justify-between rounded-xl bg-black/[0.04] px-3 py-2.5 text-left active:scale-[0.99] disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-[13px] font-medium" style={{ color: theme.textMain }}>
                        {p.name}
                      </span>
                      <span className="block text-[11px]" style={{ color: theme.textSub }}>
                        {p.desc}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0" style={{ color: theme.accent }} />
                  </button>
                ))}
              </div>
            </div>

            {/* 文件上传 */}
            <div className="mt-3 rounded-2xl p-3.5" style={card}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <FileUp className="h-4 w-4" /> 从手机上传书源文件
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-11 w-full rounded-xl border-2 border-dashed text-[13px] font-medium active:scale-[0.99]"
                style={{ borderColor: theme.accent + '55', color: theme.accent }}
              >
                选择 .json 书源文件
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
          </div>
        </div>
      )}

      {/* 删除确认（长按非内置源） */}
      {confirmDel && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="删除书源确认">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setConfirmDel(null)} />
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl p-5 text-center shadow-2xl backdrop-blur-2xl" style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}` }}>
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
                className="h-10 flex-1 rounded-full text-[14px] font-medium backdrop-blur-xl"
                style={{ ...card, color: theme.textMain }}
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
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold text-white"
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
