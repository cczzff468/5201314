'use client';

/**
 * 排版设置面板（底部抽屉，实时预览——滑块拖动底层正文立即变化）
 * 分组：字号/字体（含上传）/字重/行段字距（滑块）/页边距四向（滑块）/
 * 标题位置/对齐开关组/阅读背景（含上传）
 */
import { useRef, useState } from 'react';
import { X, Upload, Check } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  BUILTIN_FONTS,
  fileToDataUrl,
  FONT_WEIGHTS,
  READ_BGS,
  themeOf,
} from './shared';

type RdTheme = ReturnType<typeof themeOf>;

function Row({ label, children, theme }: { label: string; children: React.ReactNode; theme: RdTheme }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-[64px] shrink-0 text-[12px]" style={{ color: theme.textSub }}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  theme,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  theme: RdTheme;
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
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-black/10 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
        style={{ accentColor: theme.accent, ['--tw-shadow' as string]: theme.accent }}
      />
      <span className="w-[44px] shrink-0 text-right text-[11px] tabular-nums" style={{ color: theme.textSub }}>
        {format ? format(value) : value}
      </span>
    </div>
  );
}

function Chip({ active, onClick, children, theme }: { active: boolean; onClick: () => void; children: React.ReactNode; theme: RdTheme }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 shrink-0 rounded-full px-3.5 text-[12px] font-medium transition-all active:scale-95"
      style={active ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff', boxShadow: `0 3px 10px ${theme.accent}44` } : { background: 'rgba(120,128,140,0.12)', color: theme.textMain }}
    >
      {children}
    </button>
  );
}

export function ReaderSettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useReading((s) => s.settings);
  const patch = useReading((s) => s.patchSettings);
  const theme = themeOf(settings.appTheme);
  const dark = settings.appTheme === 'midnight';
  const bgInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState('');

  const onUploadBg = async (f: File | undefined) => {
    if (!f) return;
    setUploading('bg');
    try {
      const dataUrl = await fileToDataUrl(f, 1280, 0.8);
      patch({ bgTheme: 'custom', bgCustom: dataUrl });
    } catch {
      /* 忽略 */
    }
    setUploading('');
  };
  const onUploadFont = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(ttf|otf|woff2?)(\.|$)/i.test(f.name)) {
      setUploading('fontErr');
      setTimeout(() => setUploading(''), 2200);
      return;
    }
    setUploading('font');
    try {
      const buf = await f.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf.slice(0, buf.byteLength))));
      const mime = /\.woff2$/i.test(f.name) ? 'font/woff2' : /\.otf$/i.test(f.name) ? 'font/otf' : 'font/ttf';
      patch({ fontFamily: 'custom', fontCustom: `data:${mime};base64,${base64}` });
    } catch {
      /* 忽略 */
    }
    setUploading('');
  };

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-label="排版设置">
      <button type="button" aria-label="关闭设置" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[86%] overflow-y-auto overscroll-contain rounded-t-3xl shadow-2xl backdrop-blur-2xl"
        style={{
          background: dark ? 'rgba(18,20,28,0.96)' : 'rgba(255,255,255,0.94)',
          boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.2)`,
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl px-5 pb-2 pt-4 backdrop-blur-xl"
          style={{ background: dark ? 'rgba(18,20,28,0.85)' : 'rgba(255,255,255,0.85)' }}
        >
          <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
            排版设置
          </p>
          <button type="button" onClick={onClose} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] active:scale-90">
            <X className="h-4 w-4" style={{ color: theme.textMain }} />
          </button>
        </div>
        <p className="px-5 pb-1 text-[11px]" style={{ color: theme.textSub }}>
          所有调整实时生效 · 自动保存
        </p>

        <div className="px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
          {/* 字号 */}
          <Row theme={theme} label="字号">
            <Slider theme={theme} value={settings.fontSize} min={12} max={32} step={1} onChange={(v) => patch({ fontSize: v })} format={(v) => `${v}px`} />
          </Row>
          {/* 字重 */}
          <Row theme={theme} label="字重">
            <div className="flex gap-2">
              {FONT_WEIGHTS.map((w) => (
                <Chip theme={theme} key={w.key} active={settings.fontWeight === w.key} onClick={() => patch({ fontWeight: w.key })}>
                  <span style={{ fontWeight: w.css }}>{w.name}</span>
                </Chip>
              ))}
            </div>
          </Row>
          {/* 字体 */}
          <Row theme={theme} label="字体">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {BUILTIN_FONTS.map((f) => (
                <Chip theme={theme} key={f.key} active={settings.fontFamily === f.key} onClick={() => patch({ fontFamily: f.key })}>
                  <span style={{ fontFamily: f.css }}>{f.name}</span>
                </Chip>
              ))}
              <Chip theme={theme} active={settings.fontFamily === 'custom'} onClick={() => fontInputRef.current?.click()}>
                {settings.fontCustom ? '我的字体✓' : '上传字体'}
              </Chip>
            </div>
            <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => void onUploadFont(e.target.files?.[0])} />
          </Row>
          {uploading === 'font' && <p className="pl-[76px] text-[11px]" style={{ color: theme.accent }}>字体上传中…</p>}
          {uploading === 'fontErr' && <p className="pl-[76px] text-[11px] text-[#E05252]">仅支持 ttf/otf/woff/woff2 字体文件</p>}

          {/* 间距滑块组 */}
          <div className="mt-2 rounded-2xl p-3.5"
          style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(120,128,140,0.07)' }}>
            <Row theme={theme} label="行间距">
              <Slider theme={theme} value={settings.lineSpacing} min={1.2} max={3} step={0.05} onChange={(v) => patch({ lineSpacing: v })} format={(v) => v.toFixed(2)} />
            </Row>
            <Row theme={theme} label="段间距">
              <Slider theme={theme} value={settings.paraSpacing} min={0} max={2.5} step={0.05} onChange={(v) => patch({ paraSpacing: v })} format={(v) => v.toFixed(2)} />
            </Row>
            <Row theme={theme} label="字间距">
              <Slider theme={theme} value={settings.letterSpacing} min={-0.5} max={4} step={0.1} onChange={(v) => patch({ letterSpacing: v })} format={(v) => `${v.toFixed(1)}px`} />
            </Row>
          </div>

          {/* 页边距 */}
          <div className="mt-2 rounded-2xl p-3.5"
          style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(120,128,140,0.07)' }}>
            <Row theme={theme} label="左边距">
              <Slider theme={theme} value={settings.marginLeft} min={0} max={16} step={0.5} onChange={(v) => patch({ marginLeft: v })} format={(v) => `${v}vw`} />
            </Row>
            <Row theme={theme} label="右边距">
              <Slider theme={theme} value={settings.marginRight} min={0} max={16} step={0.5} onChange={(v) => patch({ marginRight: v })} format={(v) => `${v}vw`} />
            </Row>
            <Row theme={theme} label="上边距">
              <Slider theme={theme} value={settings.marginTop} min={0} max={14} step={0.5} onChange={(v) => patch({ marginTop: v })} format={(v) => `${v}vh`} />
            </Row>
            <Row theme={theme} label="下边距">
              <Slider theme={theme} value={settings.marginBottom} min={0} max={14} step={0.5} onChange={(v) => patch({ marginBottom: v })} format={(v) => `${v}vh`} />
            </Row>
          </div>

          {/* 标题位置 */}
          <Row theme={theme} label="标题">
            <div className="flex gap-2">
              <Chip theme={theme} active={settings.titlePosition === 'left'} onClick={() => patch({ titlePosition: 'left' })}>居左</Chip>
              <Chip theme={theme} active={settings.titlePosition === 'center'} onClick={() => patch({ titlePosition: 'center' })}>居中</Chip>
              <Chip theme={theme} active={settings.titlePosition === 'hidden'} onClick={() => patch({ titlePosition: 'hidden' })}>隐藏</Chip>
            </div>
          </Row>

          {/* 开关组（分页模式下无「底部对齐」） */}
          <div className="mt-1 space-y-1">
            {([
              ['justify', '两端对齐'],
              ['underline', '正文下划线'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => patch({ [key]: !settings[key] } as Partial<typeof settings>)}
                className="flex w-full items-center justify-between rounded-xl px-1 py-2.5 active:scale-[0.99]"
              >
                <span className="text-[14px]" style={{ color: theme.textMain }}>{label}</span>
                <span
                  className={`flex h-[26px] w-[44px] items-center rounded-full px-0.5 transition-colors ${settings[key] ? 'justify-end' : 'justify-start bg-black/[0.12]'}`}
                style={settings[key] ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` } : undefined}
                >
                  <span className={`h-[22px] w-[22px] rounded-full bg-white shadow transition-transform ${settings[key] ? '' : ''}`} />
                </span>
              </button>
            ))}
          </div>

          {/* 阅读背景 */}
          <div className="mt-3">
            <p className="mb-2 text-[12px]" style={{ color: theme.textSub }}>阅读背景</p>
            <div className="flex flex-wrap gap-2.5">
              {READ_BGS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => patch({ bgTheme: b.key, bgCustom: b.key === 'custom' ? settings.bgCustom : null })}
                  className="relative h-11 w-16 overflow-hidden rounded-xl ring-2 transition-transform active:scale-95"
                  style={{
                    background: b.bg,
                    ['--tw-ring-color' as string]: settings.bgTheme === b.key ? theme.accent : 'rgba(0,0,0,0.06)',
                  }}
                  aria-label={b.name}
                >
                  <span className="absolute inset-x-1 bottom-0.5 text-center text-[10px] font-medium" style={{ color: b.text }}>
                    {b.name}
                  </span>
                  {settings.bgTheme === b.key && (
                    <Check className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-[70%]" style={{ color: b.text }} />
                  )}
                </button>
              ))}
              {/* 自定义背景 */}
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                className="relative h-11 w-16 overflow-hidden rounded-xl ring-2 transition-transform active:scale-95"
                style={{
                  background: dark ? 'rgba(255,255,255,0.08)' : '#F2F3F5',
                  ['--tw-ring-color' as string]: settings.bgTheme === 'custom' ? theme.accent : 'rgba(0,0,0,0.06)',
                  ...(settings.bgCustom && settings.bgTheme === 'custom'
                    ? { background: `center/cover url(${settings.bgCustom})` }
                    : {}),
                }}
                aria-label="自定义背景"
              >
                {!settings.bgCustom && (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-0.5" style={{ color: theme.textSub }}>
                    <Upload className="h-3.5 w-3.5" />
                    <span className="text-[9px]">上传</span>
                  </span>
                )}
                {settings.bgTheme === 'custom' && settings.bgCustom && (
                  <Check className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 p-0.5" />
                )}
              </button>
              <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onUploadBg(e.target.files?.[0])} />
            </div>
            {uploading === 'bg' && <p className="mt-1.5 text-[11px]" style={{ color: theme.accent }}>背景上传中…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
