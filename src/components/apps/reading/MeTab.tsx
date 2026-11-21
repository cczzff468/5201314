'use client';

/**
 * 「我」Tab（参照截图1：iOS 设置风分组白卡 + pastel 图标容器 + 大圆角）
 * 分组：书源与内容 / 阅读与数据 / 外观与通用
 */
import { useMemo, useState } from 'react';
import {
  Database,
  Upload,
  History,
  Palette,
  Type,
  Trash2,
  ChevronRight,
  Sparkles,
  CircleCheck,
  CircleX,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { APP_THEMES, api, themeOf } from './shared';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';

function GroupTitle({ text, theme }: { text: string; theme: ReturnType<typeof themeOf> }) {
  return (
    <p className="mb-2 mt-5 px-1 text-[13px] font-medium" style={{ color: theme.textSub }}>
      {text}
    </p>
  );
}

function Item({
  icon,
  iconBg,
  iconColor,
  title,
  desc,
  right,
  onClick,
  theme,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  desc?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  theme: ReturnType<typeof themeOf>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-3 text-left first:rounded-t-2xl last:rounded-b-2xl active:bg-black/[0.02]"
    >
      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
          {title}
        </span>
        {desc && (
          <span className="mt-0.5 block truncate text-[12px]" style={{ color: theme.textSub }}>
            {desc}
          </span>
        )}
      </span>
      {right ?? <ChevronRight className="h-[18px] w-[18px] shrink-0" style={{ color: theme.textSub }} />}
    </button>
  );
}

export function MeTab({
  onOpenSources,
  onOpenHistory,
}: {
  onOpenSources: () => void;
  onOpenHistory: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const patch = useReading((s) => s.patchSettings);
  const sources = useReading((s) => s.sources);
  const shelf = useReading((s) => s.shelf);
  const loadSources = useReading((s) => s.loadSources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [typoOpen, setTypoOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [toast, setToast] = useState('');

  const okCount = sources.filter((s) => s.enabled).length;
  const readChapters = shelf.reduce((n, b) => n + b.lastReadChapter + 1, 0);

  const clearAI = async () => {
    await api.historyAction({ action: 'clear', kind: 'chat' }).catch(() => null);
    await api.historyAction({ action: 'clear', kind: 'summary' }).catch(() => null);
    setToast('AI 陪读记忆已清空');
    setTimeout(() => setToast(''), 2000);
  };

  const card = {
    background: theme.cardBg,
    boxShadow: 'inset 0 0 0 1px ' + theme.cardRing,
  } as const;

  return (
    <div className="px-4 pb-6">
      {/* 头卡（玻璃） */}
      <div className="flex items-center gap-4 rounded-3xl p-5" style={card}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
          <Sparkles className="h-8 w-8" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-bold" style={{ color: theme.textMain }}>
            我的书屋
          </p>
          <p className="mt-1 text-[12px]" style={{ color: theme.textSub }}>
            书架 {shelf.length} 本 · 已读 {readChapters} 章 · 启用书源 {okCount} 个
          </p>
        </div>
      </div>

      <GroupTitle text="书源与内容" theme={theme} />
      <div className="overflow-hidden rounded-3xl" style={card}>
        <Item
          theme={theme}
          icon={<Database className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#EDEBFF"
          iconColor="#6C4CF1"
          title="书源管理"
          desc={`共 ${sources.length} 个 · 启用 ${okCount} 个`}
          onClick={onOpenSources}
        />
        <div className="mx-[86px] h-px" style={{ background: theme.cardRing }} />
        <Item
          theme={theme}
          icon={<Upload className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#DFF0FF"
          iconColor="#2196F3"
          title="导入 / 上传书源"
          desc="粘贴 JSON、输入链接或从手机上传"
          onClick={onOpenSources}
        />
      </div>

      <GroupTitle text="阅读与数据" theme={theme} />
      <div className="overflow-hidden rounded-3xl" style={card}>
        <Item
          theme={theme}
          icon={<History className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#DBEAFE"
          iconColor="#3B82F6"
          title="阅读记录与 AI 记忆"
          desc="看过的书 · 聊过的天 · 剧情摘要"
          onClick={onOpenHistory}
        />
        <div className="mx-[86px] h-px" style={{ background: theme.cardRing }} />
        <Item
          theme={theme}
          icon={<Trash2 className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#FFF3D6"
          iconColor="#F5A623"
          title="清空 AI 陪读记忆"
          desc="删除所有聊天记录与章节摘要"
          onClick={() => void clearAI()}
          right={<span className="text-[12px]" style={{ color: theme.textSub }}>点击清空</span>}
        />
      </div>

      <GroupTitle text="外观与通用" theme={theme} />
      <div className="overflow-hidden rounded-3xl" style={card}>
        <Item
          theme={theme}
          icon={<Palette className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#FCE7F3"
          iconColor="#EC4899"
          title="主题风格"
          desc={`${APP_THEMES[settings.appTheme]?.name || '海洋蓝'} · 蓝色玻璃毛玻璃`}
          onClick={() => setThemeOpen(true)}
          right={
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full" style={{ background: theme.accent }} />
              <ChevronRight className="h-[18px] w-[18px]" style={{ color: theme.textSub }} />
            </span>
          }
        />
        <div className="mx-[86px] h-px" style={{ background: theme.cardRing }} />
        <Item
          theme={theme}
          icon={<Type className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#E3EDFF"
          iconColor="#4A7DE0"
          title="排版设置"
          desc="字号/字体/间距/边距/对齐（含预览）"
          onClick={() => setTypoOpen(true)}
        />
      </div>

      {/* 主题选择抽屉 */}
      {themeOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="主题风格">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={() => setThemeOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl">
            <p className="mb-4 text-[16px] font-bold text-[#1A1D26]">主题风格</p>
            <div className="grid grid-cols-3 gap-3">
              {Object.values(APP_THEMES).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    patch({ appTheme: t.key });
                    setThemeOpen(false);
                    void loadSources(true);
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl p-3 active:scale-95"
                  style={{ background: settings.appTheme === t.key ? t.accentSoft : 'rgba(0,0,0,0.03)' }}
                >
                  <span
                    className="h-10 w-10 rounded-full shadow-inner"
                    style={{ background: `linear-gradient(135deg, ${t.gradFrom}, ${t.gradTo})` }}
                  />
                  <span className="flex items-center gap-1 text-[12px] font-medium text-[#1A1D26]">
                    {t.name}
                    {settings.appTheme === t.key && <CircleCheck className="h-3.5 w-3.5" style={{ color: t.accent }} />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 排版设置（带示例预览文本） */}
      {typoOpen && (
        <div className="absolute inset-0 z-50">
          {/* 示例正文层（实时预览载体） */}
          <div className="absolute inset-0 overflow-hidden">
            <PreviewText />
          </div>
          <ReaderSettingsSheet onClose={() => setTypoOpen(false)} />
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center">
          <span className="rounded-full bg-black/75 px-4 py-2 text-[13px] text-white backdrop-blur">{toast}</span>
        </div>
      )}
    </div>
  );
}

/** 排版预览示例文段（应用当前设置渲染） */
function PreviewText() {
  const settings = useReading((s) => s.settings);
  return (
    <div
      className="h-full overflow-y-auto px-6 py-14"
      style={{
        background: settings.bgTheme === 'custom' && settings.bgCustom ? `center/cover url(${settings.bgCustom})` : undefined,
      }}
    >
      <p
        className={`mb-4 text-[1.12em] font-bold ${settings.titlePosition === 'center' ? 'text-center' : 'text-left'}`}
      >
        {settings.titlePosition === 'hidden' ? '' : '第十七章 示例章节标题'}
      </p>
      <div style={{ fontSize: settings.fontSize, lineHeight: settings.lineSpacing, letterSpacing: `${settings.letterSpacing}px` }}>
        {[
          '这是一段排版预览。拖动下方面板里的滑块，这里的文字会实时跟着变化。',
          '你可以调整字号、行间距、段间距、字间距，也可以试试页边距带来的呼吸感。',
          '两端对齐、底部对齐、下划线等开关也都在这里，一切所见即所得。',
        ].map((t, i) => (
          <p key={i} style={{ marginBottom: `${settings.paraSpacing}em`, textIndent: '2em' }}>
            {t}
          </p>
        ))}
      </div>
    </div>
  );
}
