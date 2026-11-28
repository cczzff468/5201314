'use client';

// 字体页（内置字体 / 自定义字体上传 / 字号字重）+ FontListCard。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  ChangeEvent,
  ReactNode,
} from 'react';

import {
  Check,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';

import { useSettings } from '@/lib/ios/store';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  applyAppFont,
  BUILTIN_APP_FONTS,
  customFontFamilyOf,
  deleteCustomFont,
  listCustomFonts,
  loadCustomFontFace,
  saveCustomFont,
  applyAppFontScale,
  applyAppFontWeight,
  FONT_SCALE_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  type AppFontMeta,
} from '@/lib/ios/fonts';

import {
  DetailShell,
  GrayCard,
} from './shared';


// ---------------- 字体 ----------------

/** 字体列表玻璃卡：GrayCard 同款毛玻璃配方但无内边距（divide-y 行列表用，分隔线贴边）。
 *  SETTINGS-THEME：恒浅色玻璃白，不随深色主题变黑 */
export function FontListCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-2xl">
      {children}
    </div>
  );
}

/**
 * 字体设置页（Task 33-d）：
 * - 内置 10 款「纯 CSS 栈」字体（借用系统已有字体，无需字体文件），点选即全局实时生效；
 * - 顶部预览卡实时展示当前字体的中英文/数字/标点效果；
 * - 支持导入 .ttf/.otf/.woff/.woff2 字体文件：仅存本机独立 IndexedDB（ios-phone-fonts，绝不上传服务器），
 *   通过 FontFace API 动态注册后立即可用；
 * - 全局生效原理：把字体栈写入 documentElement 的 --app-font-family CSS 变量，
 *   body 的 font-family 引用该变量（globals.css）；重启后由 PhoneShell 调 ensureAppFontApplied() 恢复。
 */
export function FontPage({ onBack }: { onBack: () => void }) {
  const appFontId = useSettings((s) => s.appFontId);
  const setAppFont = useSettings((s) => s.setAppFont);
  const appFontScale = useSettings((s) => s.appFontScale);
  const setAppFontScale = useSettings((s) => s.setAppFontScale);
  const appFontWeight = useSettings((s) => s.appFontWeight);
  const setAppFontWeight = useSettings((s) => s.setAppFontWeight);
  const [toast, showToast] = useLocalToast();
  const [customFonts, setCustomFonts] = useState<AppFontMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  // 两步删除确认：首点变红待确认，3 秒内再点才真删（超时自动复位）
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 自定义字体 FontFace 异步加载完成后 +1 触发重渲（否则预览/示例字样要等下一次渲染才能换新字体）
  const [previewLoadedTick, setPreviewLoadedTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挂载：读自定义字体列表 + 逐个预注册 FontFace（fire-and-forget，仅为预览提前就绪）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listCustomFonts();
        if (!alive) return;
        setCustomFonts(list);
        for (const f of list) {
          void loadCustomFontFace(f.id)
            .then(() => {
              if (alive) setPreviewLoadedTick((t) => t + 1);
            })
            .catch(() => undefined); // 预载失败静默：选中该字体时 applyAppFont 会再报错提示
        }
      } catch {
        // IndexedDB 不可用：列表保持为空
      }
    })();
    return () => {
      alive = false;
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
    };
  }, []);

  /** 点选字体：立即持久化 + 全局应用（不 toast，预览与界面即时可见）；失败才提示 */
  const pickFont = (id: string) => {
    setAppFont(id);
    void applyAppFont(id).catch((e) => {
      showToast(e instanceof Error ? e.message : '字体加载失败，请重试');
    });
  };

  /** 导入字体文件：校验扩展名 → 存本机 IndexedDB → 刷新列表（文件绝不上传服务器） */
  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) {
      showToast('仅支持 .ttf / .otf / .woff / .woff2 字体文件');
      return;
    }
    setUploading(true);
    try {
      const meta = await saveCustomFont(file.name, file);
      setCustomFonts(await listCustomFonts());
      // 后台预注册 FontFace：成功后预览/示例字样立即用上新字体
      void loadCustomFontFace(meta.id)
        .then(() => setPreviewLoadedTick((t) => t + 1))
        .catch(() => undefined);
      showToast(`已导入「${meta.name}」，点列表即可应用`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  /** 删除自定义字体：两步确认（首点变红，3 秒内再点执行；删的是当前字体则一并回默认） */
  const handleDeleteClick = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
    setDeletingId(null);
    void (async () => {
      try {
        await deleteCustomFont(id);
        setCustomFonts(await listCustomFonts());
        if (appFontId === id) {
          // 删的是正在使用的字体：回默认系统字体
          setAppFont('');
          try {
            await applyAppFont('');
          } catch {
            // removeProperty 不会失败，稳妥起见吞掉
          }
          showToast('已删除');
        } else {
          showToast('已从本机删除');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : '删除失败，请重试');
      }
    })();
  };

  // 当前字体的名字与预览栈（appFontId='' → 默认系统字体 = 内置第一项的栈）
  const currentBuiltin = BUILTIN_APP_FONTS.find((f) => f.id === appFontId);
  const currentCustom = appFontId.startsWith('custom:') ? customFonts.find((f) => f.id === appFontId) : undefined;
  const currentName = currentBuiltin?.name ?? currentCustom?.name ?? (appFontId ? '自定义字体' : 'iOS 系统字体（默认）');
  const previewStack = currentBuiltin?.stack ?? currentCustom?.stack ?? BUILTIN_APP_FONTS[0].stack;

  return (
    <DetailShell title="字体" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预览卡片（当前字体实时预览） */}
        <GrayCard>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{currentName}</div>
              <p className="mt-0.5 text-[12px] text-zinc-500">点下方任意字体立即全局生效</p>
            </div>
            <span className="shrink-0 rounded-full bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-white">
              当前使用
            </span>
          </div>
          <div
            key={previewLoadedTick}
            data-testid="font-page-preview"
            className="mt-3 rounded-[16px] bg-white/60 px-4 py-3 ring-1 ring-black/[0.05]"
            style={{ fontFamily: previewStack }}
          >
            <p className="text-[24px] leading-relaxed">字体预览 Aa Bb Cc 123</p>
            <p className="text-[24px] leading-relaxed">你好，世界！Hello, World! 永东国爱</p>
            <p className="text-[24px] leading-relaxed">0123456789 ，。？！：；「」《》～</p>
          </div>
        </GrayCard>

        {/* 字体大小（Task 36：calc 只缩放文字、界面框架尺寸不变，全 App 实时生效） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-zinc-500">字体大小</div>
          <GrayCard>
            <div className="flex flex-wrap items-center gap-2" data-testid="font-scale-group">
              {FONT_SCALE_OPTIONS.map((o) => {
                const active = Math.abs(appFontScale - o.scale) < 0.001;
                return (
                  <button
                    key={o.scale}
                    type="button"
                    data-testid={`font-scale-${o.scale}`}
                    aria-pressed={active}
                    onClick={() => {
                      setAppFontScale(o.scale);
                      applyAppFontScale(o.scale);
                    }}
                    className={`rounded-full px-4 py-2 text-[13.5px] shadow-[0_2px_10px_rgba(17,24,39,0.05)] backdrop-blur-xl transition-all active:scale-[0.95] ${
                      active
                        ? 'bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)]'
                        : 'bg-white/60 text-zinc-700 ring-1 ring-black/[0.06] hover:bg-white/85'
                    }`}
                  >
                    {o.label}
                    <span className="ml-1 text-[11px] opacity-60">{Math.round(o.scale * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </GrayCard>
        </section>

        {/* 字体粗细（body font-weight 变量；标题等显式字重不受影响） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-zinc-500">字体粗细</div>
          <GrayCard>
            <div className="flex flex-wrap items-center gap-2" data-testid="font-weight-group">
              {FONT_WEIGHT_OPTIONS.map((o) => {
                const active = appFontWeight === o.weight;
                return (
                  <button
                    key={o.weight}
                    type="button"
                    data-testid={`font-weight-${o.weight}`}
                    aria-pressed={active}
                    onClick={() => {
                      setAppFontWeight(o.weight);
                      applyAppFontWeight(o.weight);
                    }}
                    style={{ fontWeight: o.weight }}
                    className={`rounded-full px-4 py-2 text-[13.5px] shadow-[0_2px_10px_rgba(17,24,39,0.05)] backdrop-blur-xl transition-all active:scale-[0.95] ${
                      active
                        ? 'bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)]'
                        : 'bg-white/60 text-zinc-700 ring-1 ring-black/[0.06] hover:bg-white/85'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-zinc-500">
              大小全局生效（含以后新增的界面）；粗细对正文生效，标题/按钮等已加粗的文字保持原样。
            </p>
          </GrayCard>
        </section>

        {/* 内置字体（纯 CSS 栈，点击即应用） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-zinc-500">内置字体</div>
          <FontListCard>
            {BUILTIN_APP_FONTS.map((f) => {
              const selected = appFontId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  data-testid={`font-builtin-${f.id.replace('builtin:', '')}`}
                  onClick={() => pickFont(f.id)}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left text-zinc-900 transition-colors active:bg-black/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px]">{f.name}</span>
                  <span className="shrink-0 text-[13px] text-zinc-500" style={{ fontFamily: f.stack }}>
                    Aa 永东 123
                  </span>
                  {selected && <Check className="h-5 w-5 shrink-0 text-[#007AFF]" strokeWidth={2.6} />}
                </button>
              );
            })}
          </FontListCard>
        </section>

        {/* 我的字体（本机保存，绝不上传） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-zinc-500">我的字体（本机保存）</div>
          <GrayCard>
            <div className="flex flex-col gap-1">
              {customFonts.map((f) => {
                const selected = appFontId === f.id;
                const confirming = deletingId === f.id;
                return (
                  <div key={f.id} className="flex min-h-[52px] items-center gap-2 py-2">
                    <button
                      type="button"
                      data-testid={`font-custom-${f.id.replace('custom:', '')}`}
                      onClick={() => pickFont(f.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{f.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{f.fileName}</span>
                      </span>
                      <span
                        className="shrink-0 text-[13px] text-zinc-500"
                        style={{ fontFamily: `'${customFontFamilyOf(f.id)}', -apple-system, sans-serif` }}
                      >
                        Aa 永东 123
                      </span>
                      {selected && <Check className="h-5 w-5 shrink-0 text-[#007AFF]" strokeWidth={2.6} />}
                    </button>
                    <button
                      type="button"
                      data-testid={`font-delete-${f.id.replace('custom:', '')}`}
                      onClick={() => handleDeleteClick(f.id)}
                      aria-label={confirming ? `再次点击确认删除「${f.name}」` : `删除「${f.name}」`}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.94] ${
                        confirming
                          ? 'bg-[#FF3B30]/15 text-[#FF3B30] ring-1 ring-[#FF3B30]/40'
                          : 'bg-white/80 text-zinc-500 ring-1 ring-black/[0.06] hover:text-[#FF3B30]'
                      }`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              {customFonts.length === 0 && (
                <p className="py-2 text-center text-[13px] text-zinc-500">还没有导入字体，点下方按钮从文件导入</p>
              )}

              {/* 导入按钮 + 隐藏文件选择器 */}
              <div className="pt-1.5">
                <button
                  type="button"
                  data-testid="font-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 rounded-[14px] bg-white/80 px-4 py-2.5 text-[14px] text-zinc-900 shadow-[0_2px_10px_rgba(17,24,39,0.05)] ring-1 ring-black/[0.05] backdrop-blur-xl transition-all active:scale-[0.97] disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? '导入中…' : '导入字体文件（.ttf / .otf / .woff / .woff2）'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  data-testid="font-upload-input"
                  className="hidden"
                  onChange={(e) => void handleUpload(e)}
                />
              </div>
            </div>
          </GrayCard>
        </section>

        <p className="px-1 text-[12px] leading-relaxed text-zinc-500">
          字体文件仅保存在本机浏览器（IndexedDB），不会上传服务器；清除浏览器数据会一并删除。
        </p>
      </div>
      <LocalToast msg={toast} />
    </DetailShell>
  );
}
