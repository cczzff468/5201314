'use client';

/**
 * 阅读设置弹窗（用户截图同款双层结构）：
 * - 第一层「阅读设置」：字号步进 + Aa 字体入口 → 亮度（跟随系统）→ 阅读背景（圆形色卡，
 *   置于字号下方）→ 翻页方式（覆盖/滑动/仿真/滚动/淡入/无动画）→ 底部 [自动阅读] [更多设置]
 * - 第二层「更多设置」：搜索框 + 排版/翻页/屏幕/其它 四 Tab
 *   · 排版：排版方案 / 间距（预览+行段字距）/ 页边距 / 字体粗细 / 标题位置 / 段首缩进 /
 *          版式开关（两端对齐·底部对齐·下划线·中文排版优化·特殊样式）/ 繁简转换
 *   · 翻页：音量键翻页（无提示文案）/ 点击翻页 / 自动阅读速度
 *   · 屏幕：亮度 / 屏幕常亮 / 显示时间 / 显示电量
 *   · 其它：字体（含上传）/ 我的排版预设 / 恢复默认排版
 * 所有调整实时生效并自动保存。
 */
import { useMemo, useRef, useState } from 'react';
import {
  X, Upload, Check, Minus, Plus, Trash2, Play, Settings2, Search, Sun, Palette,
  BookOpen, SlidersHorizontal, LayoutTemplate, MoveHorizontal, Bold, AlignLeft,
  IndentIncrease, Type, CaseSensitive, RotateCcw, SunMoon, Gauge, Languages,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  BUILTIN_FONTS,
  DEFAULT_SETTINGS,
  fileToDataUrl,
  FONT_WEIGHTS,
  READ_BGS,
  themeOf,
  type ReaderPreset,
} from './shared';

type RdTheme = ReturnType<typeof themeOf>;

/** 截图主蓝 */
const BLUE = '#3D7EFF';
const blueSoft = (dark: boolean) => (dark ? 'rgba(93,133,236,0.20)' : '#E8F0FE');
const softBg = (dark: boolean) => (dark ? 'rgba(255,255,255,0.07)' : 'rgba(120,128,140,0.08)');

/** 蓝色圆点滑块（右端数值） */
function BlueSlider({
  value, min, max, step, onChange, format, dark,
}: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string; dark: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label="滑块"
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#3D7EFF] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#3D7EFF] [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(61,126,255,0.45)]"
        style={{ accentColor: BLUE, background: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)' }}
      />
      <span className="w-[44px] shrink-0 text-right text-[11px] tabular-nums" style={{ color: BLUE }}>
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/** 胶囊按钮组 */
function PillRow({
  options, value, onChange, dark,
}: {
  options: { key: string; label: React.ReactNode }[];
  value: string;
  onChange: (k: string) => void;
  dark: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className="h-9 min-w-[56px] shrink-0 grow rounded-[10px] px-3 text-[13px] font-medium transition-all active:scale-95"
          style={
            value === o.key
              ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
              : { background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 开关行 */
function SwitchRow({
  label, desc, on, onChange, dark,
}: {
  label: string; desc?: string; on: boolean; onChange: (v: boolean) => void; dark: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:opacity-70"
    >
      <span className="min-w-0">
        <span className="block text-[14px]" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>{label}</span>
        {desc && <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: dark ? 'rgba(232,234,242,0.45)' : '#999' }}>{desc}</span>}
      </span>
      <span
        className={`flex h-[26px] w-[44px] shrink-0 items-center rounded-full px-0.5 transition-colors ${on ? 'justify-end' : 'justify-start'}`}
        style={on ? { background: BLUE } : { background: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' }}
      >
        <span className="h-[22px] w-[22px] rounded-full bg-white shadow transition-transform" />
      </span>
    </button>
  );
}

/** 分组卡片标题 */
function GroupTitle({
  icon, title, right, dark,
}: {
  icon: React.ReactNode; title: string; right?: React.ReactNode; dark: boolean;
}) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>
        <span style={{ color: BLUE }}>{icon}</span>
        {title}
      </p>
      {right}
    </div>
  );
}

/** 圆形小图标（标题左侧装饰） */
function HeadIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-full text-white"
      style={{ background: `linear-gradient(135deg, #6FA8FF, ${BLUE})` }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

// ===========================================================================
// 第二层：更多设置
// ===========================================================================
type TabKey = 'type' | 'turn' | 'screen' | 'other';

function MoreSettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useReading((s) => s.settings);
  const patch = useReading((s) => s.patchSettings);
  const dark = settings.appTheme === 'midnight';
  const [tab, setTab] = useState<TabKey>('type');
  const [kw, setKw] = useState('');
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState('');

  const match = (...keys: string[]) => {
    const k = kw.trim().toLowerCase();
    if (!k) return true;
    return keys.some((x) => x.toLowerCase().includes(k));
  };

  const onUploadFont = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(ttf|otf|woff2?)(\.|$)/i.test(f.name)) {
      setUploadState('仅支持 ttf/otf/woff/woff2 字体文件');
      setTimeout(() => setUploadState(''), 2200);
      return;
    }
    setUploadState('上传中…');
    try {
      const buf = await f.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf.slice(0, buf.byteLength))));
      const mime = /\.woff2$/i.test(f.name) ? 'font/woff2' : /\.otf$/i.test(f.name) ? 'font/otf' : 'font/ttf';
      patch({ fontFamily: 'custom', fontCustom: `data:${mime};base64,${base64}` });
      setUploadState('字体已应用 ✓');
    } catch {
      setUploadState('字体上传失败');
    }
    setTimeout(() => setUploadState(''), 2200);
  };

  const savePreset = () => {
    const name = presetName.trim().slice(0, 16);
    if (!name) return;
    const p: ReaderPreset = {
      id: `p${Date.now()}`,
      name,
      data: {
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        fontWeight: settings.fontWeight,
        letterSpacing: settings.letterSpacing,
        lineSpacing: settings.lineSpacing,
        paraSpacing: settings.paraSpacing,
        marginLeft: settings.marginLeft,
        marginRight: settings.marginRight,
        marginTop: settings.marginTop,
        marginBottom: settings.marginBottom,
        titlePosition: settings.titlePosition,
        justify: settings.justify,
        underline: settings.underline,
        textIndent: settings.textIndent,
        cjkOptimize: settings.cjkOptimize,
      },
    };
    patch({ presets: [...settings.presets, p].slice(-12) });
    setPresetName('');
    setSchemeOpen(true);
  };

  const ANIMS: { key: string; label: string }[] = [
    { key: 'cover', label: '覆盖' },
    { key: 'slide', label: '滑动' },
    { key: 'curl', label: '仿真' },
    { key: 'scroll', label: '滚动' },
    { key: 'fade', label: '淡入' },
    { key: 'none', label: '无动画' },
  ];

  return (
    <div className="absolute inset-0 z-[52]" role="dialog" aria-label="更多设置">
      <button type="button" aria-label="关闭更多设置" className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[86%] overflow-y-auto overscroll-contain rounded-t-[22px] shadow-2xl"
        style={{ background: dark ? '#16181F' : '#FFFFFF', boxShadow: '0 -14px 48px rgba(0,0,0,0.28)' }}
      >
        {/* 拖动条 */}
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="h-1.5 w-10 rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
        </div>
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 pb-2 pt-1.5">
          <p className="flex items-center gap-2 text-[17px] font-bold" style={{ color: dark ? '#F2F3F7' : '#1A1D26' }}>
            <HeadIcon>
              <Settings2 className="h-[15px] w-[15px]" />
            </HeadIcon>
            更多设置
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-full active:scale-90"
            style={{ background: softBg(dark) }}
          >
            <X className="h-4 w-4" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-5 pb-2.5">
          <div className="flex h-10 items-center gap-2 rounded-full px-3.5" style={{ background: softBg(dark) }}>
            <Search className="h-4 w-4 shrink-0" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }} />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索设置项，如『行距』『音量键』『背景』"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}
              aria-label="搜索设置项"
            />
            {kw && (
              <button type="button" onClick={() => setKw('')} aria-label="清空" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tab 栏 */}
        <div className="flex gap-2 px-5 pb-3">
          {(
            [
              { k: 'type' as TabKey, label: '排版' },
              { k: 'turn' as TabKey, label: '翻页' },
              { k: 'screen' as TabKey, label: '屏幕' },
              { k: 'other' as TabKey, label: '其它' },
            ]
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className="h-8 grow rounded-full text-[13px] font-medium transition-all active:scale-95"
              style={tab === t.k ? { background: BLUE, color: '#fff' } : { background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 pb-[max(22px,env(safe-area-inset-bottom))]">
          {/* ======================= 排版 Tab ======================= */}
          {tab === 'type' && (
            <div className="space-y-3">
              {/* 排版方案 */}
              {match('排版方案', '预设') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setSchemeOpen((v) => !v)}
                  >
                    <span className="flex items-center gap-1.5 text-[14px]" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>
                      <LayoutTemplate className="h-4 w-4" style={{ color: BLUE }} />
                      排版方案
                      <span className="rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: blueSoft(dark), color: BLUE }}>
                        {settings.presets.length} 套
                      </span>
                    </span>
                    <span className="text-[11px]" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }}>
                      {schemeOpen ? '收起' : '一键应用 · 保存当前'} ›
                    </span>
                  </button>
                  {schemeOpen && (
                    <div className="mt-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && savePreset()}
                          placeholder="把当前排版存为方案，如「夜间大字」"
                          maxLength={16}
                          className="h-9 min-w-0 flex-1 rounded-xl px-3 text-[13px] outline-none"
                          style={{ background: dark ? 'rgba(255,255,255,0.08)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }}
                          aria-label="方案名称"
                        />
                        <button
                          type="button"
                          onClick={savePreset}
                          disabled={!presetName.trim()}
                          className="h-9 shrink-0 rounded-xl px-4 text-[12px] font-semibold text-white disabled:opacity-40"
                          style={{ background: BLUE }}
                        >
                          保存
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {settings.presets.map((p) => (
                          <span
                            key={p.id}
                            className="flex items-center gap-1 rounded-full py-1.5 pl-3 pr-1.5 text-[12px]"
                            style={{ background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }}
                          >
                            <button type="button" className="active:scale-95" onClick={() => patch(p.data)} aria-label={`应用 ${p.name}`}>
                              {p.name}
                              <span className="ml-1 text-[10px] opacity-60">{p.data.fontSize}px</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => patch({ presets: settings.presets.filter((x) => x.id !== p.id) })}
                              className="flex h-5 w-5 items-center justify-center rounded-full active:scale-90"
                              style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }}
                              aria-label={`删除 ${p.name}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 间距 */}
              {match('间距', '行距', '行间距', '段间距', '字间距', '字距') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle
                    dark={dark}
                    icon={<SlidersHorizontal className="h-4 w-4" />}
                    title="间距"
                    right={
                      <button
                        type="button"
                        className="text-[11px]"
                        style={{ color: BLUE }}
                        onClick={() =>
                          patch({ lineSpacing: DEFAULT_SETTINGS.lineSpacing, paraSpacing: DEFAULT_SETTINGS.paraSpacing, letterSpacing: DEFAULT_SETTINGS.letterSpacing })
                        }
                      >
                        还原默认
                      </button>
                    }
                  />
                  <div
                    className="mb-2.5 rounded-xl px-3 py-2 text-center"
                    style={{
                      background: dark ? 'rgba(255,255,255,0.06)' : '#fff',
                      color: dark ? '#E8EAF2' : '#333',
                      fontSize: Math.min(15, Math.max(11, settings.fontSize - 3)),
                      lineHeight: settings.lineSpacing,
                      letterSpacing: `${settings.letterSpacing}px`,
                    }}
                    aria-hidden="true"
                  >
                    春江潮水连海平，海上明月共潮生。
                    <br />
                    滟滟随波千万里，何处春江无月明。
                  </div>
                  <div className="space-y-2.5">
                    <div>
                      <p className="mb-1 text-[12px]" style={{ color: dark ? 'rgba(232,234,242,0.55)' : '#777' }}>行间距</p>
                      <BlueSlider dark={dark} value={settings.lineSpacing} min={1.2} max={3} step={0.05} onChange={(v) => patch({ lineSpacing: v })} format={(v) => `${v.toFixed(2)}×`} />
                    </div>
                    <div>
                      <p className="mb-1 text-[12px]" style={{ color: dark ? 'rgba(232,234,242,0.55)' : '#777' }}>段间距</p>
                      <BlueSlider dark={dark} value={settings.paraSpacing} min={0} max={2.5} step={0.05} onChange={(v) => patch({ paraSpacing: v })} format={(v) => `${v.toFixed(2)}×`} />
                    </div>
                    <div>
                      <p className="mb-1 text-[12px]" style={{ color: dark ? 'rgba(232,234,242,0.55)' : '#777' }}>字间距</p>
                      <BlueSlider dark={dark} value={settings.letterSpacing} min={-0.5} max={4} step={0.1} onChange={(v) => patch({ letterSpacing: v })} format={(v) => v.toFixed(1)} />
                    </div>
                  </div>
                </div>
              )}

              {/* 页边距 */}
              {match('页边距', '边距', '左边距', '右边距', '上边距', '下边距') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle
                    dark={dark}
                    icon={<MoveHorizontal className="h-4 w-4" />}
                    title="页边距"
                    right={
                      <button
                        type="button"
                        className="text-[11px]"
                        style={{ color: BLUE }}
                        onClick={() =>
                          patch({
                            marginLeft: DEFAULT_SETTINGS.marginLeft,
                            marginRight: DEFAULT_SETTINGS.marginRight,
                            marginTop: DEFAULT_SETTINGS.marginTop,
                            marginBottom: DEFAULT_SETTINGS.marginBottom,
                          })
                        }
                      >
                        还原默认
                      </button>
                    }
                  />
                  <div className="space-y-2.5">
                    {(
                      [
                        ['marginLeft', '左边距'],
                        ['marginRight', '右边距'],
                        ['marginTop', '上边距'],
                        ['marginBottom', '下边距'],
                      ] as const
                    ).map(([k, label]) => (
                      <div key={k}>
                        <p className="mb-1 text-[12px]" style={{ color: dark ? 'rgba(232,234,242,0.55)' : '#777' }}>
                          {label}
                        </p>
                        <BlueSlider
                          dark={dark}
                          value={settings[k]}
                          min={0}
                          max={16}
                          step={0.5}
                          onChange={(v) => patch({ [k]: v })}
                          format={(v) => `${v}vw`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 字体粗细 */}
              {match('字体粗细', '粗细', '字重') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle dark={dark} icon={<Bold className="h-4 w-4" />} title="字体粗细" />
                  <PillRow
                    dark={dark}
                    value={settings.fontWeight}
                    onChange={(k) => patch({ fontWeight: k as ReaderPreset['data']['fontWeight'] })}
                    options={FONT_WEIGHTS.map((w) => ({ key: w.key, label: <span style={{ fontWeight: w.css }}>{w.name}</span> }))}
                  />
                </div>
              )}

              {/* 标题位置 */}
              {match('标题位置', '标题') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle dark={dark} icon={<AlignLeft className="h-4 w-4" />} title="标题位置" />
                  <PillRow
                    dark={dark}
                    value={settings.titlePosition}
                    onChange={(k) => patch({ titlePosition: k as 'left' | 'center' | 'hidden' })}
                    options={[
                      { key: 'left', label: '居左' },
                      { key: 'center', label: '居中' },
                      { key: 'hidden', label: '隐藏' },
                    ]}
                  />
                </div>
              )}

              {/* 段首缩进 */}
              {match('段首缩进', '缩进') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle dark={dark} icon={<IndentIncrease className="h-4 w-4" />} title="段首缩进" />
                  <PillRow
                    dark={dark}
                    value={String(settings.textIndent)}
                    onChange={(k) => patch({ textIndent: parseInt(k, 10) })}
                    options={[
                      { key: '0', label: '无' },
                      { key: '1', label: '1字' },
                      { key: '2', label: '2字' },
                      { key: '3', label: '3字' },
                      { key: '4', label: '4字' },
                    ]}
                  />
                </div>
              )}

              {/* 版式开关 */}
              {match('版式', '两端对齐', '底部对齐', '下划线', '排版优化', '特殊样式') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle dark={dark} icon={<Type className="h-4 w-4" />} title="版式" />
                  <SwitchRow dark={dark} label="两端对齐" on={settings.justify} onChange={(v) => patch({ justify: v })} />
                  <SwitchRow dark={dark} label="底部对齐" on={settings.bottomAlign} onChange={(v) => patch({ bottomAlign: v })} />
                  <SwitchRow dark={dark} label="正文下划线" on={settings.underline} onChange={(v) => patch({ underline: v })} />
                  <SwitchRow
                    dark={dark}
                    label="中文排版优化"
                    desc="字符间距均匀挤压，行尾更整齐"
                    on={settings.cjkOptimize}
                    onChange={(v) => patch({ cjkOptimize: v })}
                  />
                  <SwitchRow
                    dark={dark}
                    label="适配特殊样式"
                    desc="识别正文里 [newpage] 等特殊标记并优化排版"
                    on={settings.specialTags}
                    onChange={(v) => patch({ specialTags: v })}
                  />
                </div>
              )}

              {/* 繁简转换 */}
              {match('繁简', '繁体', '简体') && (
                <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                  <GroupTitle dark={dark} icon={<Languages className="h-4 w-4" />} title="繁简转换" />
                  <PillRow
                    dark={dark}
                    value={settings.s2t}
                    onChange={(k) => patch({ s2t: k as 'off' | 's2t' | 't2s' })}
                    options={[
                      { key: 'off', label: '关闭' },
                      { key: 't2s', label: '繁转简' },
                      { key: 's2t', label: '简转繁' },
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          {/* ======================= 翻页 Tab ======================= */}
          {tab === 'turn' && (
            <div className="space-y-3">
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <GroupTitle dark={dark} icon={<BookOpen className="h-4 w-4" />} title="翻页方式" />
                <PillRow
                  dark={dark}
                  value={settings.pageAnim}
                  onChange={(k) => patch({ pageAnim: k as typeof settings.pageAnim })}
                  options={ANIMS}
                />
              </div>
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <SwitchRow dark={dark} label="音量键翻页" on={settings.keyTurn} onChange={(v) => patch({ keyTurn: v })} />
                <SwitchRow dark={dark} label="点击翻页" desc="左右 1/3 屏点击翻页，中间 1/3 弹菜单" on={settings.clickTurn} onChange={(v) => patch({ clickTurn: v })} />
              </div>
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <GroupTitle dark={dark} icon={<Gauge className="h-4 w-4" />} title="自动阅读" />
                <PillRow
                  dark={dark}
                  value={String(settings.autoReadSec)}
                  onChange={(k) => patch({ autoReadSec: parseInt(k, 10) })}
                  options={[
                    { key: '0', label: '关闭' },
                    { key: '10', label: '10秒' },
                    { key: '15', label: '15秒' },
                    { key: '20', label: '20秒' },
                    { key: '30', label: '30秒' },
                  ]}
                />
              </div>
            </div>
          )}

          {/* ======================= 屏幕 Tab ======================= */}
          {tab === 'screen' && (
            <div className="space-y-3">
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <GroupTitle
                  dark={dark}
                  icon={<Sun className="h-4 w-4" />}
                  title="亮度"
                  right={
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={settings.brightnessAuto ? { background: BLUE, color: '#fff' } : { background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }}
                      onClick={() => patch({ brightnessAuto: !settings.brightnessAuto })}
                    >
                      跟随系统
                    </button>
                  }
                />
                <BlueSlider
                  dark={dark}
                  value={settings.brightness}
                  min={10}
                  max={100}
                  step={1}
                  onChange={(v) => patch({ brightness: v, brightnessAuto: false })}
                  format={(v) => `${v}%`}
                />
              </div>
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <SwitchRow dark={dark} label="屏幕常亮" desc="阅读时保持屏幕不熄灭" on={settings.keepScreenOn} onChange={(v) => patch({ keepScreenOn: v })} />
                <SwitchRow dark={dark} label="显示时间" on={settings.showTime} onChange={(v) => patch({ showTime: v })} />
                <SwitchRow dark={dark} label="显示电量" on={settings.showBattery} onChange={(v) => patch({ showBattery: v })} />
              </div>
            </div>
          )}

          {/* ======================= 其它 Tab ======================= */}
          {tab === 'other' && (
            <div className="space-y-3">
              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <GroupTitle dark={dark} icon={<CaseSensitive className="h-4 w-4" />} title="字体" />
                <div className="flex flex-wrap gap-2">
                  {BUILTIN_FONTS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => patch({ fontFamily: f.key })}
                      className="h-9 shrink-0 whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-medium active:scale-95"
                      style={
                        settings.fontFamily === f.key
                          ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
                          : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }
                      }
                    >
                      <span style={{ fontFamily: f.css }}>{f.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fontInputRef.current?.click()}
                    className="h-9 shrink-0 rounded-[10px] px-3.5 text-[13px] font-medium active:scale-95"
                    style={
                      settings.fontFamily === 'custom'
                        ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
                        : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }
                    }
                  >
                    {settings.fontCustom ? '我的字体 ✓' : '+ 上传字体'}
                  </button>
                  <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => void onUploadFont(e.target.files?.[0])} />
                </div>
                {uploadState && <p className="mt-1.5 text-[11px]" style={{ color: BLUE }}>{uploadState}</p>}
              </div>

              <div className="rounded-2xl p-3.5" style={{ background: softBg(dark) }}>
                <GroupTitle
                  dark={dark}
                  icon={<LayoutTemplate className="h-4 w-4" />}
                  title="排版方案"
                  right={
                    <button type="button" className="text-[11px]" style={{ color: BLUE }} onClick={() => setSchemeOpen(true)}>
                      管理 ›
                    </button>
                  }
                />
                <div className="flex flex-wrap gap-2">
                  {settings.presets.length ? (
                    settings.presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => patch(p.data)}
                        className="rounded-full px-3 py-1.5 text-[12px] active:scale-95"
                        style={{ background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }}
                      >
                        {p.name}
                      </button>
                    ))
                  ) : (
                    <p className="text-[11px]" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }}>
                      到「排版」Tab 保存当前排版为方案，之后这里一键切换
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  patch({
                    fontSize: DEFAULT_SETTINGS.fontSize,
                    lineSpacing: DEFAULT_SETTINGS.lineSpacing,
                    paraSpacing: DEFAULT_SETTINGS.paraSpacing,
                    letterSpacing: DEFAULT_SETTINGS.letterSpacing,
                    marginLeft: DEFAULT_SETTINGS.marginLeft,
                    marginRight: DEFAULT_SETTINGS.marginRight,
                    marginTop: DEFAULT_SETTINGS.marginTop,
                    marginBottom: DEFAULT_SETTINGS.marginBottom,
                    titlePosition: DEFAULT_SETTINGS.titlePosition,
                    justify: DEFAULT_SETTINGS.justify,
                    underline: DEFAULT_SETTINGS.underline,
                    textIndent: DEFAULT_SETTINGS.textIndent,
                    cjkOptimize: DEFAULT_SETTINGS.cjkOptimize,
                    s2t: DEFAULT_SETTINGS.s2t,
                  })
                }
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-medium active:scale-95"
                style={{ background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }}
              >
                <RotateCcw className="h-4 w-4" /> 恢复默认排版
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 第一层：阅读设置（主弹窗）
// ===========================================================================
export function ReaderSettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useReading((s) => s.settings);
  const patch = useReading((s) => s.patchSettings);
  const dark = settings.appTheme === 'midnight';
  const bgInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fontPop, setFontPop] = useState(false);
  const [uploadState, setUploadState] = useState('');

  const fontName = useMemo(
    () => (settings.fontFamily === 'custom' ? (settings.fontCustom ? '我的字体' : '上传') : (BUILTIN_FONTS.find((f) => f.key === settings.fontFamily)?.name || '默认')),
    [settings.fontFamily, settings.fontCustom],
  );

  const onUploadBg = async (f: File | undefined) => {
    if (!f) return;
    setUploadState('背景上传中…');
    try {
      const dataUrl = await fileToDataUrl(f, 1280, 0.8);
      patch({ bgTheme: 'custom', bgCustom: dataUrl });
      setUploadState('');
    } catch {
      setUploadState('背景上传失败');
      setTimeout(() => setUploadState(''), 2000);
    }
  };

  const onUploadFont = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(ttf|otf|woff2?)(\.|$)/i.test(f.name)) {
      setUploadState('仅支持 ttf/otf/woff/woff2 字体文件');
      setTimeout(() => setUploadState(''), 2200);
      return;
    }
    setUploadState('字体上传中…');
    try {
      const buf = await f.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf.slice(0, buf.byteLength))));
      const mime = /\.woff2$/i.test(f.name) ? 'font/woff2' : /\.otf$/i.test(f.name) ? 'font/otf' : 'font/ttf';
      patch({ fontFamily: 'custom', fontCustom: `data:${mime};base64,${base64}` });
      setUploadState('字体已应用 ✓');
    } catch {
      setUploadState('字体上传失败');
    }
    setTimeout(() => setUploadState(''), 2200);
  };

  const autoOn = settings.autoReadSec > 0;

  /** 点击「更多设置」后：主弹窗消失，仅展示更多设置层；关闭即整体关闭（放在全部 hooks 之后） */
  if (moreOpen) return <MoreSettingsSheet onClose={onClose} />;

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-label="阅读设置">
      <button type="button" aria-label="关闭设置" className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[82%] overflow-y-auto overscroll-contain rounded-t-[22px] shadow-2xl"
        style={{ background: dark ? '#16181F' : '#FFFFFF', boxShadow: '0 -14px 48px rgba(0,0,0,0.28)' }}
      >
        {/* 拖动条（紧凑） */}
        <div className="flex justify-center pb-0.5 pt-2">
          <span className="h-1.5 w-10 rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
        </div>

        <div className="px-5 pb-[max(12px,env(safe-area-inset-bottom))]">
          {/* 标题（紧凑） */}
          <div className="flex items-center justify-between pb-2.5">
            <p className="flex items-center gap-2 text-[16px] font-bold" style={{ color: dark ? '#F2F3F7' : '#1A1D26' }}>
              <HeadIcon>
                <SlidersHorizontal className="h-[14px] w-[14px]" />
              </HeadIcon>
              阅读设置
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full active:scale-90"
              style={{ background: softBg(dark) }}
            >
              <X className="h-4 w-4" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }} />
            </button>
          </div>

          {/* 字号：加减步进 + 字体入口（紧凑） */}
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center justify-center gap-4">
              <button
                type="button"
                aria-label="减小字号"
                disabled={settings.fontSize <= 12}
                onClick={() => patch({ fontSize: Math.max(12, settings.fontSize - 1) })}
                className="flex h-9 w-9 items-center justify-center rounded-full active:scale-90 disabled:opacity-30"
                style={{ border: `1.5px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)'}` }}
              >
                <Minus className="h-4 w-4" strokeWidth={2.6} style={{ color: dark ? '#E8EAF2' : '#1A1D26' }} />
              </button>
              <span className="min-w-[40px] text-center text-[22px] font-bold leading-none tabular-nums" style={{ color: dark ? '#F2F3F7' : '#1A1D26' }} aria-live="polite">
                {settings.fontSize}
              </span>
              <button
                type="button"
                aria-label="增大字号"
                disabled={settings.fontSize >= 32}
                onClick={() => patch({ fontSize: Math.min(32, settings.fontSize + 1) })}
                className="flex h-9 w-9 items-center justify-center rounded-full active:scale-90 disabled:opacity-30"
                style={{ border: `1.5px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)'}` }}
              >
                <Plus className="h-4 w-4" strokeWidth={2.6} style={{ color: dark ? '#E8EAF2' : '#1A1D26' }} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFontPop((v) => !v)}
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-medium active:scale-95"
              style={{ background: softBg(dark), color: dark ? '#E8EAF2' : '#333' }}
            >
              <span className="font-serif" style={{ fontSize: 14 }}>Aa</span> {fontName} ›
            </button>
          </div>
          {fontPop && (
            <div className="mt-2.5 rounded-2xl p-3" style={{ background: softBg(dark) }}>
              <div className="flex flex-wrap gap-2">
                {BUILTIN_FONTS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => patch({ fontFamily: f.key })}
                    className="h-9 shrink-0 whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-medium active:scale-95"
                    style={
                      settings.fontFamily === f.key
                        ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
                        : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }
                    }
                  >
                    <span style={{ fontFamily: f.css }}>{f.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => fontInputRef.current?.click()}
                  className="h-9 shrink-0 rounded-[10px] px-3.5 text-[13px] font-medium active:scale-95"
                  style={
                    settings.fontFamily === 'custom'
                      ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
                      : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }
                  }
                >
                  {settings.fontCustom ? '我的字体 ✓' : '+ 上传'}
                </button>
                <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => void onUploadFont(e.target.files?.[0])} />
              </div>
              {uploadState && uploadState !== '背景上传中…' && <p className="mt-1.5 text-[11px]" style={{ color: BLUE }}>{uploadState}</p>}
            </div>
          )}

          {/* 亮度（紧凑） */}
          <div className="mt-2.5 rounded-2xl p-3" style={{ background: softBg(dark) }}>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>
                <Sun className="h-4 w-4" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }} /> 亮度
              </p>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={settings.brightnessAuto ? { background: BLUE, color: '#fff' } : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#333' }}
                onClick={() => patch({ brightnessAuto: !settings.brightnessAuto })}
              >
                跟随系统
              </button>
            </div>
            <div className="flex items-center gap-2.5">
              <SunMoon className="h-[15px] w-[15px] shrink-0" style={{ color: dark ? 'rgba(232,234,242,0.45)' : '#BBB' }} />
              <BlueSlider
                dark={dark}
                value={settings.brightness}
                min={10}
                max={100}
                step={1}
                onChange={(v) => patch({ brightness: v, brightnessAuto: false })}
                format={(v) => `${v}%`}
              />
              <Sun className="h-[17px] w-[17px] shrink-0" style={{ color: dark ? 'rgba(232,234,242,0.45)' : '#BBB' }} />
            </div>
          </div>

          {/* 阅读背景（字号下方；紧凑圆形色卡） */}
          <div className="mt-2.5 rounded-2xl p-3" style={{ background: softBg(dark) }}>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>
              <Palette className="h-4 w-4" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }} /> 背景
            </p>
            <div className="flex flex-wrap gap-2">
              {READ_BGS.map((b) => {
                const active = settings.bgTheme === b.key;
                return (
                  <div key={b.key} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => patch({ bgTheme: b.key, bgCustom: b.key === 'custom' ? settings.bgCustom : null })}
                      className="relative flex h-[44px] w-[44px] items-center justify-center overflow-hidden rounded-full transition-transform active:scale-90"
                      style={{
                        background: b.bg,
                        boxShadow: active ? `0 0 0 2.5px ${BLUE}` : `0 0 0 1.5px ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`,
                      }}
                      aria-label={`背景：${b.name}`}
                    >
                      <span className="text-[15px]" style={{ color: b.text, fontWeight: 500 }}>文</span>
                      {active && (
                        <Check className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full p-0.5 text-white" style={{ background: BLUE }} />
                      )}
                    </button>
                    <span className="text-[10px]" style={{ color: active ? BLUE : dark ? 'rgba(232,234,242,0.5)' : '#999' }}>
                      {b.name}
                    </span>
                  </div>
                );
              })}
              {/* 自定义背景 */}
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (settings.bgCustom) patch({ bgTheme: 'custom' });
                    else bgInputRef.current?.click();
                  }}
                  className="relative flex h-[44px] w-[44px] items-center justify-center overflow-hidden rounded-full transition-transform active:scale-90"
                  style={{
                    background: settings.bgCustom && settings.bgTheme === 'custom' ? `center/cover url(${settings.bgCustom})` : dark ? 'rgba(255,255,255,0.08)' : '#F2F3F5',
                    boxShadow: settings.bgTheme === 'custom' ? `0 0 0 2.5px ${BLUE}` : `0 0 0 1.5px ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`,
                  }}
                  aria-label="自定义背景"
                >
                  {!settings.bgCustom && (
                    <Plus className="h-4 w-4" style={{ color: dark ? 'rgba(232,234,242,0.6)' : '#999' }} />
                  )}
                  {settings.bgTheme === 'custom' && settings.bgCustom && (
                    <Check className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full p-0.5 text-white" style={{ background: BLUE }} />
                  )}
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-[10px]" style={{ color: settings.bgTheme === 'custom' ? BLUE : dark ? 'rgba(232,234,242,0.5)' : '#999' }}>
                    自定义
                  </span>
                  {settings.bgCustom && (
                    <button
                      type="button"
                      onClick={() => bgInputRef.current?.click()}
                      className="text-[10px] underline"
                      style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#BBB' }}
                    >
                      换图
                    </button>
                  )}
                </div>
              </div>
              <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onUploadBg(e.target.files?.[0])} />
            </div>
            {uploadState === '背景上传中…' && <p className="mt-1.5 text-[11px]" style={{ color: BLUE }}>{uploadState}</p>}
          </div>

          {/* 翻页方式（紧凑） */}
          <div className="mt-2.5 rounded-2xl p-3" style={{ background: softBg(dark) }}>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: dark ? '#E8EAF2' : '#1A1D26' }}>
              <BookOpen className="h-4 w-4" style={{ color: dark ? 'rgba(232,234,242,0.5)' : '#999' }} /> 翻页方式
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: 'cover', label: '覆盖' },
                  { key: 'slide', label: '滑动' },
                  { key: 'curl', label: '仿真' },
                  { key: 'scroll', label: '滚动' },
                  { key: 'fade', label: '淡入' },
                  { key: 'none', label: '无动画' },
                ]
              ).map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => patch({ pageAnim: a.key as typeof settings.pageAnim })}
                  className="h-9 whitespace-nowrap rounded-[11px] text-[13px] font-medium transition-all active:scale-95"
                  style={
                    settings.pageAnim === a.key
                      ? { background: blueSoft(dark), color: BLUE, fontWeight: 600 }
                      : { background: dark ? 'rgba(255,255,255,0.10)' : '#fff', color: dark ? '#E8EAF2' : '#1A1D26' }
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* 底部操作（紧凑） */}
          <div className="mt-2.5 flex gap-2.5">
            <button
              type="button"
              onClick={() => patch({ autoReadSec: autoOn ? 0 : 15 })}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium active:scale-95"
              style={autoOn ? { background: BLUE, color: '#fff' } : { background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }}
            >
              <Play className="h-4 w-4" /> {autoOn ? `自动阅读 ${settings.autoReadSec}s` : '自动阅读'}
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium active:scale-95"
              style={{ background: softBg(dark), color: dark ? '#E8EAF2' : '#1A1D26' }}
            >
              <Settings2 className="h-4 w-4" /> 更多设置 ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
