'use client';

/**
 * 「我」Tab：我的资料头卡（头像/昵称/自定义ID，可编辑）+ 阅读统计胶囊 + 分组玻璃卡设置项
 * 分组：书源与内容 / 阅读与数据（阅读记录与 AI 记忆）/ 外观与通用（主题/排版）
 * 主题选择与排版设置为底部玻璃抽屉；资料编辑为居中玻璃卡弹窗。
 */
import { useMemo, useRef, useState } from 'react';
import {
  Database,
  Upload,
  History,
  Palette,
  Type,
  ChevronRight,
  CircleCheck,
  Layers,
  Pencil,
  Camera,
  UserRound,
  Hash,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { APP_THEMES, fileToDataUrl, themeOf } from './shared';
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
      className="flex w-full items-center gap-3.5 px-4 py-3 text-left first:rounded-t-3xl last:rounded-b-3xl active:bg-black/[0.02]"
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
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [typoOpen, setTypoOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // 资料编辑草稿
  const [draftName, setDraftName] = useState('');
  const [draftId, setDraftId] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const okCount = sources.filter((s) => s.enabled).length;
  const readChapters = shelf.reduce((n, b) => n + b.lastReadChapter + 1, 0);

  const card = {
    background: theme.cardBg,
    boxShadow: 'inset 0 0 0 1px ' + theme.cardRing,
  } as const;

  const openProfile = () => {
    setDraftName(settings.profileName || '');
    setDraftId(settings.profileId || '');
    setDraftAvatar(settings.profileAvatar);
    setProfileOpen(true);
  };

  const saveProfile = () => {
    setSaving(true);
    patch({
      profileName: draftName.trim() || null,
      profileId: draftId.trim() || null,
      profileAvatar: draftAvatar,
    });
    setTimeout(() => {
      setSaving(false);
      setProfileOpen(false);
    }, 250);
  };

  return (
    <div className="px-4 pb-6">
      {/* 我的资料头卡（头像 + 名字 + ID，点编辑） */}
      <button
        type="button"
        onClick={openProfile}
        className="flex w-full items-center gap-4 rounded-3xl p-5 text-left backdrop-blur-xl active:scale-[0.99]"
        style={card}
      >
        {settings.profileAvatar ? (
          <img src={settings.profileAvatar} alt="我的头像" className="h-[68px] w-[68px] shrink-0 rounded-full object-cover ring-2 shadow-md" style={{ boxShadow: `0 6px 18px ${theme.accent}33` }} />
        ) : (
          <span
            className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 8px 20px ${theme.accent}44` }}
          >
            <UserRound className="h-9 w-9" strokeWidth={1.8} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[19px] font-bold" style={{ color: theme.textMain }}>
              {settings.profileName || '书友'}
            </span>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
              <Pencil className="h-3 w-3" />
            </span>
          </span>
          <span className="mt-1 flex items-center gap-1 text-[12px]" style={{ color: theme.textSub }}>
            <Hash className="h-3 w-3" /> ID：{settings.profileId || '未设置'}
          </span>
          <span className="mt-0.5 block text-[12px]" style={{ color: theme.textSub }}>
            书架 {shelf.length} 本 · 已读 {readChapters} 章
          </span>
        </span>
      </button>

      {/* 阅读统计胶囊 */}
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          { n: shelf.length, label: '在读书籍' },
          { n: readChapters, label: '已读章节' },
          { n: okCount, label: '可用书源' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-3 text-center backdrop-blur-xl" style={card}>
            <p className="text-[20px] font-bold tabular-nums" style={{ color: theme.accent }}>
              {s.n}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <GroupTitle text="书源与内容" theme={theme} />
      <div className="overflow-hidden rounded-3xl backdrop-blur-xl" style={card}>
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
      <div className="overflow-hidden rounded-3xl backdrop-blur-xl" style={card}>
        <Item
          theme={theme}
          icon={<History className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#DBEAFE"
          iconColor="#3B82F6"
          title="阅读记录与 AI 记忆"
          desc="看过的书 · 聊过的天 · 剧情摘要"
          onClick={onOpenHistory}
        />
      </div>

      <GroupTitle text="外观与通用" theme={theme} />
      <div className="overflow-hidden rounded-3xl backdrop-blur-xl" style={card}>
        <Item
          theme={theme}
          icon={<Palette className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#FCE7F3"
          iconColor="#EC4899"
          title="主题风格"
          desc={`${APP_THEMES[settings.appTheme]?.name || '海洋蓝'} · 玻璃毛玻璃`}
          onClick={() => setThemeOpen(true)}
          right={
            <span className="flex items-center gap-2">
              <span
                className="h-4 w-4 rounded-full ring-1 ring-black/10"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
              />
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
        <div className="mx-[86px] h-px" style={{ background: theme.cardRing }} />
        <Item
          theme={theme}
          icon={<Layers className="h-[22px] w-[22px]" strokeWidth={2} />}
          iconBg="#E8F8F0"
          iconColor="#12A06A"
          title="阅读背景"
          desc={`${settings.bgTheme === 'custom' ? '自定义图片' : '内置 6 款'} · 排版面板里可换`}
          onClick={() => setTypoOpen(true)}
        />
      </div>

      {/* 资料编辑弹窗（头像 / 名字 / ID） */}
      {profileOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="编辑我的资料">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setProfileOpen(false)} />
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-3xl p-5 shadow-2xl backdrop-blur-2xl" style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 24px 64px rgba(0,0,0,0.2)` }}>
            <p className="text-center text-[16px] font-bold" style={{ color: theme.textMain }}>
              编辑我的资料
            </p>
            {/* 头像 */}
            <div className="mt-4 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                aria-label="更换头像"
                className="relative active:scale-95"
              >
                {draftAvatar ? (
                  <img src={draftAvatar} alt="我的头像" className="h-20 w-20 rounded-full object-cover ring-2 ring-white/70" style={{ boxShadow: `0 8px 22px ${theme.accent}44` }} />
                ) : (
                  <span
                    className="flex h-20 w-20 items-center justify-center rounded-full text-white"
                    style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 8px 22px ${theme.accent}44` }}
                  >
                    <Camera className="h-8 w-8" strokeWidth={1.8} />
                  </span>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md" style={{ background: theme.accent }}>
                  <Camera className="h-3.5 w-3.5" />
                </span>
              </button>
              <p className="text-[11px]" style={{ color: theme.textSub }}>
                点击更换头像
              </p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const dataUrl = await fileToDataUrl(f, 480, 0.85);
                    setDraftAvatar(dataUrl);
                  } catch {
                    /* 图片读取失败静默 */
                  }
                  e.target.value = '';
                }}
              />
            </div>
            {/* 名字 */}
            <div className="mt-3">
              <p className="mb-1.5 text-[12px] font-medium" style={{ color: theme.textSub }}>
                我的名字
              </p>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={24}
                placeholder="给自己起个名字"
                className="h-11 w-full rounded-xl bg-black/[0.05] px-3 text-[14px] outline-none"
                style={{ color: theme.textMain }}
              />
            </div>
            {/* ID */}
            <div className="mt-3">
              <p className="mb-1.5 text-[12px] font-medium" style={{ color: theme.textSub }}>
                我的 ID（可自定义）
              </p>
              <input
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                maxLength={24}
                placeholder="例如 5201314"
                className="h-11 w-full rounded-xl bg-black/[0.05] px-3 text-[14px] tabular-nums outline-none"
                style={{ color: theme.textMain }}
              />
            </div>
            {/* 保存/清除头像 */}
            <div className="mt-4 flex gap-2.5">
              {draftAvatar && (
                <button
                  type="button"
                  onClick={() => setDraftAvatar(null)}
                  className="h-11 shrink-0 rounded-full px-5 text-[14px] font-medium"
                  style={{ ...card, color: '#E05252' }}
                >
                  清除头像
                </button>
              )}
              <button
                type="button"
                onClick={saveProfile}
                disabled={saving}
                className="h-11 min-w-0 flex-1 rounded-full text-[14px] font-semibold text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 6px 18px ${theme.accent}44` }}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主题选择抽屉（玻璃） */}
      {themeOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="主题风格">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setThemeOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <p className="mb-4 text-[16px] font-bold" style={{ color: theme.textMain }}>
              主题风格
            </p>
            <div className="grid grid-cols-3 gap-3">
              {Object.values(APP_THEMES).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    patch({ appTheme: t.key });
                    setThemeOpen(false);
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl p-3 backdrop-blur-xl active:scale-95"
                  style={{
                    background: settings.appTheme === t.key ? t.accentSoft : 'rgba(0,0,0,0.03)',
                    boxShadow: `inset 0 0 0 1px ${settings.appTheme === t.key ? t.accent + '44' : 'transparent'}`,
                  }}
                >
                  <span
                    className="h-10 w-10 rounded-full shadow-inner"
                    style={{ background: `linear-gradient(135deg, ${t.gradFrom}, ${t.gradTo})` }}
                  />
                  <span className="flex items-center gap-1 text-[12px] font-medium" style={{ color: theme.textMain }}>
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
          '两端对齐、下划线等开关也都在这里，一切所见即所得。',
        ].map((t, i) => (
          <p key={i} style={{ marginBottom: `${settings.paraSpacing}em`, textIndent: '2em' }}>
            {t}
          </p>
        ))}
      </div>
    </div>
  );
}
