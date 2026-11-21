'use client';

/**
 * 液态玻璃主题 · 皮肤设置（本轮重构：独立整页 → 主题页内联收缩面板）
 * ---------------------------------------------------------------------------
 * 位置：主题页 › 液态玻璃主题卡下方（LiquidSkinPanel，无独立界面）。
 * 形态：三段可收缩区块（点标题行展开/收起，默认全部收起，简约）——
 *  1. 聊天顶栏名字：四种模式（名字 / 头像+名字 / 双头像 / 双头像+名字），
 *     每格带迷你预览；双头像模式可自定义中间文字；头像+名字模式可隐藏名字。
 *  2. （仅微信）分类标签文字：五个输入框（空 = 默认文字）。
 *  3. （仅微信）列表小组件：网易云音乐 / 日历 / 自定义 CSS。
 *
 * 修改即时写入 useSettings.setLiquidSkin（App 隔离）并持久化，聊天页/列表实时跟随。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Camera, Check, ChevronRight, LayoutGrid, Music2, Paintbrush, PanelTop, RotateCcw, Tags, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '@/lib/ios/store';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
import {
  LIQUID_CUSTOM_WIDGET_EXAMPLE,
  LIQUID_HEADER_MODE_LABEL,
  LIQUID_TABS,
  liquidTabLabel,
  type LiquidHeaderMode,
  type LiquidSkinSettings,
  type LiquidTabKey,
} from '@/lib/ios/liquid-skin';
import type { BubbleAppId } from '@/lib/ios/bubble-style';

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string }> = {
  wx: { name: '微信', accent: '#07C160' },
  qq: { name: 'QQ', accent: '#0099FF' },
  sms: { name: '信息', accent: '#007AFF' },
};

// ---------------- 迷你头像（预览用，不读真实头像：纯色渐变示意） ----------------

/** TA 的头像（粉紫渐变 · 示意） */
function MiniAvatarPeer({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg,#F0A0B8,#C86DD7)',
        boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.6)',
      }}
    />
  );
}

/** 我的头像（App accent 渐变 · 示意） */
function MiniAvatarMine({ size = 24, accent }: { size?: number; accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg,${accent},#AF52DE00)`,
        backgroundColor: accent,
        boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.6)',
      }}
    />
  );
}

// ---------------- 顶栏模式迷你预览（一节小顶栏：左返回示意 + 中央名字区） ----------------

function HeaderModePreview({
  mode,
  middle,
  showName,
  accent,
}: {
  mode: LiquidHeaderMode;
  middle: string;
  showName: boolean;
  accent: string;
}) {
  const name = '安吉丽娜';
  const mid = middle || '';
  return (
    <div className="relative flex h-[42px] items-center justify-center overflow-hidden rounded-[14px] bg-[#F1F2F6] dark:bg-[#1B1D22]">
      <span className="absolute left-2 top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white/80 shadow-sm dark:bg-white/15" />
      {mode === 'text' && (
        <span className="rounded-full bg-white/90 px-3 py-[5px] text-[10.5px] font-semibold text-black/85 shadow-sm dark:bg-white/15 dark:text-white/90">
          {name}
        </span>
      )}
      {mode === 'avatarName' && (
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 py-[4px] pl-[5px] pr-3 shadow-sm dark:bg-white/15">
          <MiniAvatarPeer size={20} />
          {showName && <span className="text-[10.5px] font-semibold text-black/85 dark:text-white/90">{name}</span>}
        </span>
      )}
      {mode === 'dual' && (
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 py-[4px] pl-[5px] pr-[7px] shadow-sm dark:bg-white/15">
          <MiniAvatarPeer size={22} />
          {mid && <span className="text-[10px] font-semibold text-black/75 dark:text-white/85">{mid}</span>}
          <MiniAvatarMine size={22} accent={accent} />
        </span>
      )}
      {mode === 'dualName' && (
        /* 双头像+名字：名字在各自头像下面（两列）；中间可插自定义文字 */
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 py-[4px] pl-[7px] pr-[9px] shadow-sm dark:bg-white/15">
          <span className="flex w-[36px] flex-col items-center gap-[1.5px]">
            <MiniAvatarPeer size={17} />
            <span className="max-w-[36px] truncate text-[7.5px] font-medium leading-none text-black/60 dark:text-white/65">{name}</span>
          </span>
          {mid && <span className="text-[9px] font-semibold text-black/75 dark:text-white/85">{mid}</span>}
          <span className="flex w-[36px] flex-col items-center gap-[1.5px]">
            <MiniAvatarMine size={17} accent={accent} />
            <span className="max-w-[36px] truncate text-[7.5px] font-medium leading-none text-black/60 dark:text-white/65">我</span>
          </span>
        </span>
      )}
      <span className="absolute right-2 top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white/80 shadow-sm dark:bg-white/15" />
    </div>
  );
}

// ================= 收缩区块（点标题行展开/收起） =================

function CollapseSection({
  icon,
  title,
  summary,
  accent,
  open,
  onToggle,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  accent: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className={open ? 'border-t border-black/[0.05] first:border-t-0 dark:border-white/[0.07]' : 'first:border-t-0'}>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => {
          onToggle();
          navigator.vibrate?.(6);
        }}
        className="flex w-full items-center gap-2.5 px-4 py-[13px] text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
      >
        <span
          className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: `${accent}1F` }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-tight text-black/85 dark:text-white/90">{title}</span>
          <span className="mt-[2px] block truncate text-[11.5px] leading-tight text-black/40 dark:text-white/40">{summary}</span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-black/25 transition-transform duration-300 dark:text-white/25 ${open ? 'rotate-90' : ''}`}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 网易云小组件顶部身份实时预览（跟随微信 / 自定义） */
function MusicIdentityPreview({ skin, wxMe }: { skin: LiquidSkinSettings; wxMe?: { name: string; avatar: string | null } }) {
  const av = skin.musicFollowWx ? (wxMe?.avatar ?? null) : skin.musicAvatar || null;
  const nm = skin.musicFollowWx ? (wxMe?.name ?? '微信昵称') : skin.musicName.trim() || '我';
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.05]" data-testid="liquid-music-preview">
      {av ? (
        <img src={av} alt="" className="h-[24px] w-[24px] shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="h-[24px] w-[24px] shrink-0 rounded-full bg-[#C9C9CE] dark:bg-[#3C3C42]" />
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-black/70 dark:text-white/75">{nm}</span>
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center gap-1 rounded-full bg-[#C20C0C]/[0.08] px-2 py-[2px] text-[9px] font-semibold text-[#C20C0C] dark:bg-[#FF5A5A]/[0.14] dark:text-[#FF6B6B]"
      >
        <Music2 className="h-[9px] w-[9px]" strokeWidth={2.6} />
        网易云音乐
      </span>
    </div>
  );
}

// ================= 主面板（内联收缩式，无独立界面） =================

export interface LiquidSkinPanelProps {
  app: BubbleAppId;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
  /** （仅微信）当前登录账号的头像/昵称——网易云小组件「跟随微信」预览用 */
  wxMe?: { name: string; avatar: string | null };
}

/** 液态玻璃设置 · 收缩面板（嵌在主题页液态玻璃主题下方）：
 *  三段区块默认全部收起，点标题行展开；区块头带当前值摘要，一目了然。 */
export function LiquidSkinPanel({ app, onToast, wxMe }: LiquidSkinPanelProps) {
  const meta = PLATFORM_META[app];
  const liquidSkin = useSettings((s) => s.liquidSkin);
  const setLiquidSkin = useSettings((s) => s.setLiquidSkin);

  const skin: LiquidSkinSettings = liquidSkin[app];

  /** 三段区块独立收缩（默认全收起，简约） */
  const [sec, setSec] = useState<'header' | 'tabs' | 'widgets' | null>(null);
  const toggle = (k: 'header' | 'tabs' | 'widgets') => setSec((v) => (v === k ? null : k));

  const patch = (p: Partial<LiquidSkinSettings>) => setLiquidSkin(app, p);
  const patchTab = (key: LiquidTabKey, v: string) => {
    patch({ tabLabels: { ...skin.tabLabels, [key]: v } });
  };

  const modes = Object.keys(LIQUID_HEADER_MODE_LABEL) as LiquidHeaderMode[];
  const isWx = app === 'wx';
  const customTabCount = LIQUID_TABS.filter((t) => (skin.tabLabels[t.key] ?? '').length > 0).length;
  const widgetOnCount = [skin.widgetMusic, skin.widgetCalendar, skin.widgetCustom].filter(Boolean).length;

  return (
    <div
      className="overflow-hidden rounded-[18px] bg-white ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]"
      data-testid="liquid-skin-panel"
    >
      {/* ---------- 1. 聊天顶栏名字 ---------- */}
      <CollapseSection
        testId="liquid-sec-header"
        accent={meta.accent}
        icon={<PanelTop className="h-[15px] w-[15px]" style={{ color: meta.accent }} strokeWidth={2.1} aria-hidden="true" />}
        title="聊天顶栏名字"
        summary={`当前：${LIQUID_HEADER_MODE_LABEL[skin.headerMode]}`}
        open={sec === 'header'}
        onToggle={() => toggle('header')}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {modes.map((mode) => {
            const selected = skin.headerMode === mode;
            return (
              <button
                key={mode}
                type="button"
                data-testid={`liquid-header-${mode}`}
                aria-pressed={selected}
                onClick={() => {
                  patch({ headerMode: mode });
                  navigator.vibrate?.(6);
                }}
                className={`relative rounded-[14px] bg-black/[0.02] p-1.5 text-left ring-1 transition-all active:scale-[0.97] dark:bg-white/[0.04] ${
                  selected ? 'ring-[1.5px]' : 'ring-black/[0.06] dark:ring-white/[0.10]'
                }`}
                style={selected ? { ['--tw-ring-color' as string]: meta.accent } : undefined}
              >
                <HeaderModePreview mode={mode} middle={skin.headerMiddleText} showName={skin.headerShowName} accent={meta.accent} />
                <div className="mt-1.5 flex items-center gap-1 px-1 pb-0.5">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-tight text-black/75 dark:text-white/80">
                    {LIQUID_HEADER_MODE_LABEL[mode]}
                  </span>
                  {selected && (
                    <span
                      className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: meta.accent }}
                    >
                      <Check className="h-[9px] w-[9px]" strokeWidth={3.4} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 双头像模式：中间自定义文字 */}
        {(skin.headerMode === 'dual' || skin.headerMode === 'dualName') && (
          <div className="mt-2.5">
            <label className="block px-1 text-[12px] font-medium text-black/55 dark:text-white/55" htmlFor="liquid-middle-text">
              中间的文字（留空只显示头像）
            </label>
            <input
              id="liquid-middle-text"
              data-testid="liquid-middle-text"
              value={skin.headerMiddleText}
              onChange={(e) => patch({ headerMiddleText: e.target.value.slice(0, 24) })}
              placeholder="如 >_< ≦"
              className="mt-1.5 h-9 w-full rounded-[10px] bg-black/[0.04] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
            />
          </div>
        )}

        {/* 头像+名字模式：显示名字开关 */}
        {skin.headerMode === 'avatarName' && (
          <div className="mt-2.5 flex items-center gap-3 rounded-[12px] bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.04]">
            <span className="min-w-0 flex-1 text-[13.5px] leading-tight text-black/75 dark:text-white/80">显示名字</span>
            <Switch data-testid="liquid-show-name" checked={skin.headerShowName} onCheckedChange={(v) => patch({ headerShowName: v })} />
          </div>
        )}
        <p className="mt-1.5 px-1 text-[11px] leading-tight text-black/35 dark:text-white/35">仅液态主题聊天页生效；群聊保持群名。</p>
      </CollapseSection>

      {/* ---------- 2. 分类标签文字（仅微信） ---------- */}
      {isWx && (
        <CollapseSection
          testId="liquid-sec-tabs"
          accent={meta.accent}
          icon={<Tags className="h-[15px] w-[15px]" style={{ color: meta.accent }} strokeWidth={2.1} aria-hidden="true" />}
          title="分类标签文字"
          summary={customTabCount > 0 ? `已自定义 ${customTabCount} 项` : '默认'}
          open={sec === 'tabs'}
          onToggle={() => toggle('tabs')}
        >
          <div className="space-y-2">
            {LIQUID_TABS.map((t) => (
              <div key={t.key} className="flex items-center gap-2.5">
                <span className="w-[46px] shrink-0 text-[12.5px] text-black/45 dark:text-white/45">{t.fallback}</span>
                <input
                  data-testid={`liquid-tab-${t.key}`}
                  value={skin.tabLabels[t.key] ?? ''}
                  onChange={(e) => patchTab(t.key, e.target.value.slice(0, 12))}
                  placeholder={`默认「${t.fallback}」`}
                  className="h-9 min-w-0 flex-1 rounded-[10px] bg-black/[0.04] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
                />
                {(skin.tabLabels[t.key] ?? '').length > 0 && (
                  <button
                    type="button"
                    aria-label={`恢复${t.fallback}默认文字`}
                    onClick={() => patchTab(t.key, '')}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-black/20 text-white active:bg-black/35 dark:bg-white/25"
                  >
                    <RotateCcw className="h-[10px] w-[10px]" strokeWidth={2.6} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[11px] leading-tight text-black/35 dark:text-white/35">留空即用默认文字。</p>
        </CollapseSection>
      )}

      {/* ---------- 3. 列表小组件（仅微信） ---------- */}
      {isWx && (
        <CollapseSection
          testId="liquid-sec-widgets"
          accent={meta.accent}
          icon={<LayoutGrid className="h-[15px] w-[15px]" style={{ color: meta.accent }} strokeWidth={2.1} aria-hidden="true" />}
          title="列表小组件"
          summary={widgetOnCount > 0 ? `${widgetOnCount} 项开启` : '全部关闭'}
          open={sec === 'widgets'}
          onToggle={() => toggle('widgets')}
        >
          {/* 网易云音乐 */}
          <div className="flex items-center gap-3 py-1" data-testid="liquid-widget-row-music">
            <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(194,12,12,0.10)' }}>
              <Music2 className="h-[16px] w-[16px]" style={{ color: '#C20C0C' }} strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1 text-[14px] leading-tight text-black/85 dark:text-white/90">网易云音乐</span>
            <Switch data-testid="liquid-widget-music" checked={skin.widgetMusic} onCheckedChange={(v) => patch({ widgetMusic: v })} />
          </div>
          {/* 网易云身份（开关打开才显示） */}
          {skin.widgetMusic && (
            <div className="mt-1 rounded-[12px] bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.04]" data-testid="liquid-music-identity">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[13.5px] leading-tight text-black/75 dark:text-white/80">头像昵称跟随微信</span>
                <Switch data-testid="liquid-music-follow" checked={skin.musicFollowWx} onCheckedChange={(v) => patch({ musicFollowWx: v })} />
              </div>
              {!skin.musicFollowWx && (
                <div className="mt-2.5 flex items-center gap-3">
                  <label
                    data-testid="liquid-music-avatar"
                    aria-label="更换小组件头像"
                    className="relative flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-black/[0.05] ring-1 ring-black/[0.06] active:opacity-70 dark:bg-white/[0.08] dark:ring-white/[0.10]"
                  >
                    {skin.musicAvatar ? (
                      <img src={skin.musicAvatar} alt="小组件头像" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="h-[17px] w-[17px] text-black/35 dark:text-white/40" strokeWidth={2} />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        fileToAvatarDataUrl(f)
                          .then((url) => {
                            patch({ musicAvatar: url });
                            onToast('小组件头像已更新');
                          })
                          .catch(() => onToast('图片处理失败，换一张试试'));
                      }}
                    />
                  </label>
                  <input
                    data-testid="liquid-music-name"
                    value={skin.musicName}
                    onChange={(e) => patch({ musicName: e.target.value.slice(0, 24) })}
                    placeholder="自定义昵称（留空显示「我」）"
                    className="h-9 min-w-0 flex-1 rounded-[10px] bg-black/[0.04] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
                  />
                  {skin.musicAvatar && (
                    <button
                      type="button"
                      aria-label="移除自定义头像"
                      onClick={() => patch({ musicAvatar: '' })}
                      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-black/45 active:opacity-60 dark:bg-white/[0.10] dark:text-white/50"
                    >
                      <X className="h-[13px] w-[13px]" strokeWidth={2.4} />
                    </button>
                  )}
                </div>
              )}
              <MusicIdentityPreview skin={skin} wxMe={wxMe} />
            </div>
          )}
          {/* 日历 */}
          <div className="mt-1 flex items-center gap-3 py-1" data-testid="liquid-widget-row-calendar">
            <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(255,69,58,0.10)' }}>
              <CalendarDays className="h-[16px] w-[16px]" style={{ color: '#FF453A' }} strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1 text-[14px] leading-tight text-black/85 dark:text-white/90">日历</span>
            <Switch data-testid="liquid-widget-calendar" checked={skin.widgetCalendar} onCheckedChange={(v) => patch({ widgetCalendar: v })} />
          </div>
          {/* 自定义 CSS */}
          <div className="mt-1 flex items-center gap-3 py-1" data-testid="liquid-widget-row-custom">
            <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(175,82,222,0.10)' }}>
              <Paintbrush className="h-[16px] w-[16px]" style={{ color: '#AF52DE' }} strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1 text-[14px] leading-tight text-black/85 dark:text-white/90">自定义 CSS 小组件</span>
            <Switch data-testid="liquid-widget-custom" checked={skin.widgetCustom} onCheckedChange={(v) => patch({ widgetCustom: v })} />
          </div>
          {/* 自定义内容编辑（开关打开才显示） */}
          {skin.widgetCustom && (
            <div className="mt-1 rounded-[12px] bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.04]">
              <div className="flex items-center gap-2">
                <label className="min-w-0 flex-1 text-[12.5px] font-medium text-black/60 dark:text-white/60" htmlFor="liquid-custom-html">
                  内容（支持 &lt;style&gt;）
                </label>
                <button
                  type="button"
                  data-testid="liquid-custom-example"
                  onClick={() => {
                    patch({ customHtml: LIQUID_CUSTOM_WIDGET_EXAMPLE });
                    onToast('已插入示例，可在列表里看到效果');
                  }}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium active:opacity-60"
                  style={{ color: meta.accent, backgroundColor: `${meta.accent}1A` }}
                >
                  插入示例
                </button>
                {skin.customHtml && (
                  <button
                    type="button"
                    aria-label="清空自定义内容"
                    onClick={() => patch({ customHtml: '' })}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium text-black/45 active:opacity-60 dark:text-white/45"
                  >
                    清空
                  </button>
                )}
              </div>
              <textarea
                id="liquid-custom-html"
                data-testid="liquid-custom-html"
                value={skin.customHtml}
                onChange={(e) => patch({ customHtml: e.target.value.slice(0, 20000) })}
                rows={5}
                placeholder={'<style>…</style>\n<div class="my-card">你好呀</div>'}
                className="mt-2 w-full resize-y rounded-[10px] bg-black/[0.04] p-3 font-mono text-[12px] leading-relaxed text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
              />
            </div>
          )}
          <p className="mt-1.5 px-1 text-[11px] leading-tight text-black/35 dark:text-white/35">
            显示在会话列表搜索框下方；网易云可控制播放。
          </p>
        </CollapseSection>
      )}
    </div>
  );
}

/** 分类标签生效文字（会话列表渲染用；从 store 读） */
export function useWxTabLabels(): (key: LiquidTabKey) => string {
  const skin = useSettings((s) => s.liquidSkin.wx);
  return (key: LiquidTabKey) => liquidTabLabel(skin, key);
}
