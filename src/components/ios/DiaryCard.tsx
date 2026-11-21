'use client';

import { useRef, useState } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { Clock, Ellipsis, Heart, ImageDown, StickyNote } from 'lucide-react';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { fileToScaledDataURL, PROFILE_AVATAR_DEFAULT } from './ProfileCard';

/**
 * 日记小组件（第三页通栏方卡）：仿日记详情页样式——
 * 顶部「名字 · 日记」标题条 + 头像/名字/@ID + 正文文案 + 时间 + 操作栏（喜欢/小纸条/存为图片）。
 * 头像与文字均可在编辑器里修改；深浅主题自适应（浅色=白卡黑字、深色=黑卡白字）。
 */

/** 日记小组件数据 */
export interface DiaryCardData {
  /** 名字（同时用于顶部标题「名字 · 日记」） */
  name: string;
  /** ID（显示为 @ID，不带 @ 前缀存储） */
  handle: string;
  /** 日记正文 */
  text: string;
  /** 时间戳文本（保存正文时自动更新） */
  time: string;
  /** 头像 dataURL；null = 用内置默认图 */
  avatar: string | null;
}

export const DIARY_CARD_KEY = 'home.diaryCard.v1';
/** 默认头像：与信息卡片同一张（Angelina 萌宠头像） */
export const DIARY_AVATAR_DEFAULT = PROFILE_AVATAR_DEFAULT;

/** 默认内容（用户指定：名字/ID/文案；保存时时间自动刷新） */
export const DEFAULT_DIARY_CARD: DiaryCardData = {
  name: '𝓐𝓷𝓰𝓮𝓵𝓲𝓷𝓪',
  handle: '5201314',
  text: '向流星雨許願一個沒有悲傷的明天',
  time: '2026-07-25 00:28',
  avatar: null,
};

/** 读取持久化的日记数据（损坏/缺失时回退默认值） */
export function loadDiaryCard(): DiaryCardData {
  try {
    const p = kvGet<Partial<DiaryCardData>>(DIARY_CARD_KEY);
    if (!p) return DEFAULT_DIARY_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    return {
      name: str(p.name, DEFAULT_DIARY_CARD.name),
      handle: str(p.handle, DEFAULT_DIARY_CARD.handle).replace(/^@+/, ''),
      text: str(p.text, DEFAULT_DIARY_CARD.text),
      time: str(p.time, DEFAULT_DIARY_CARD.time),
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
    };
  } catch {
    return DEFAULT_DIARY_CARD;
  }
}

/** 本地时间 → 「YYYY-MM-DD HH:mm」（保存正文时刷新时间戳） */
function formatNow(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 操作栏条目（纯装饰，复刻参考图） */
const DIARY_ACTIONS = [
  { Icon: Heart, label: '喜欢' },
  { Icon: StickyNote, label: '小纸条' },
  { Icon: ImageDown, label: '存为图片' },
] as const;

/** 卡片可视内容（通栏 4 列 2 行槽位 ≈342×168 满格）：标题条 + 作者行 + 正文 + 时间 + 操作栏 */
export function DiaryCardWidget({ data }: { data: DiaryCardData }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  const subText = dark ? 'text-white/40' : 'text-black/35';
  return (
    <div
      className={`flex h-[168px] w-full select-none flex-col overflow-hidden rounded-[24px] ${
        dark ? 'bg-[#151517] text-white ring-1 ring-white/10' : 'bg-white/95 text-[#161618] ring-1 ring-black/10'
      }`}
    >
      {/* 标题条：名字 · 日记 */}
      <div
        className={`flex h-[34px] shrink-0 items-center justify-center border-b text-[14px] font-bold ${
          dark ? 'border-white/[0.08] bg-white/[0.04]' : 'border-black/[0.06] bg-black/[0.03]'
        }`}
      >
        <p className="max-w-full truncate px-3">{data.name} · 日记</p>
      </div>
      {/* 正文区 */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-[6px] pt-[8px]">
        {/* 作者行：头像 + 名字 + @ID */}
        <div className="flex items-center gap-[9px]">
          <img
            src={data.avatar || DIARY_AVATAR_DEFAULT}
            alt="日记头像"
            draggable={false}
            className={`h-[34px] w-[34px] shrink-0 select-none rounded-full object-cover ${
              dark ? 'ring-1 ring-white/15' : 'ring-1 ring-black/10'
            }`}
          />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold leading-[17px]">{data.name}</p>
            <p className={`truncate text-[11px] leading-[13px] ${subText}`}>@{data.handle}</p>
          </div>
        </div>
        {/* 正文 */}
        <p className="mt-[7px] line-clamp-2 break-all text-[14px] font-bold leading-[19px]">{data.text}</p>
        {/* 时间 */}
        <p className={`mt-[5px] flex items-center gap-[4px] text-[11px] leading-[13px] ${subText}`}>
          <Clock className="h-[11px] w-[11px] shrink-0" aria-hidden="true" />
          {data.time}
        </p>
        {/* 操作栏（装饰） */}
        <div
          className={`mt-auto flex items-center border-t pt-[6px] text-[11px] leading-none ${subText} ${
            dark ? 'border-white/[0.08]' : 'border-black/[0.07]'
          }`}
        >
          {DIARY_ACTIONS.map(({ Icon, label }, i) => (
            <span key={label} className={`flex items-center gap-[5px] ${i === 0 ? '' : 'ml-auto'}`}>
              <Icon className="h-[13px] w-[13px]" aria-hidden="true" />
              {label}
            </span>
          ))}
          <span className="ml-auto flex items-center">
            <Ellipsis className="h-[13px] w-[13px]" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-[10px] bg-white/10 px-3 py-[8px] text-[14px] text-white outline-none ring-1 ring-white/10 transition-colors placeholder:text-white/35 focus:bg-white/15 focus:ring-white/20';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-[6px] block text-[12px] font-medium text-white/55">{label}</span>
      {children}
    </label>
  );
}

/** 编辑器（主屏根层级底部弹窗）：换头像 / 改名字 / 改 ID / 改文案，保存写回 localStorage
 *  （保存时时间戳自动刷新）。由父组件按需条件渲染（open 时才挂载），草稿用当前数据初始化。 */
export function DiaryCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: DiaryCardData;
  onClose: () => void;
  onSave: (d: DiaryCardData) => void;
}) {
  const [draft, setDraft] = useState<DiaryCardData>(data);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：input.click() 的合成 click / 系统选图器关闭后的幽灵 click 会误关弹窗
   *  （与信息卡片编辑器同款防护），开选图器后 1.5s 内忽略遮罩点击 */
  const pickGuardUntil = useRef(0);

  const save = () => {
    const clean = (s: string) => s.trim();
    onSave({
      name: clean(draft.name) || DEFAULT_DIARY_CARD.name,
      handle: clean(draft.handle).replace(/^@+/, ''),
      text: clean(draft.text),
      time: formatNow(),
      avatar: draft.avatar,
    });
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑日记"
      className="absolute inset-0 z-[70] flex flex-col bg-black/55 backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (Date.now() < pickGuardUntil.current) return;
        onClose();
      }}
    >
      <div className="mt-auto px-2 pb-3" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-[24px] bg-[#1d1d1f]/95 p-4 text-white shadow-[0_-8px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
          {/* 顶栏 */}
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={onClose} className="text-[15px] text-white/65 transition-opacity active:opacity-50">
              取消
            </button>
            <p className="text-[15px] font-semibold">编辑日记</p>
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-white px-4 py-[5px] text-[14px] font-semibold text-black transition-transform active:scale-95"
            >
              保存
            </button>
          </div>

          <div className="no-scrollbar max-h-[42vh] space-y-4 overflow-y-auto pr-0.5">
            {/* 头像 */}
            <div className="flex items-center gap-3">
              <img
                src={draft.avatar || DIARY_AVATAR_DEFAULT}
                alt="头像预览"
                className="h-[52px] w-[52px] shrink-0 rounded-full object-cover ring-1 ring-white/15"
              />
              <div className="flex flex-col items-start gap-[6px]">
                <button
                  type="button"
                  onClick={() => {
                    pickGuardUntil.current = Date.now() + 1500;
                    avatarInput.current?.click();
                  }}
                  className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
                >
                  更换头像
                </button>
                {draft.avatar && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, avatar: null }))}
                    className="text-[11px] text-white/50 transition-colors active:text-white/80"
                  >
                    恢复默认头像
                  </button>
                )}
              </div>
            </div>

            {/* 文字字段 */}
            <Field label="名字">
              <input
                value={draft.name}
                maxLength={16}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className={inputCls}
                placeholder="昵称"
              />
            </Field>
            <Field label="ID">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-white/45">@</span>
                <input
                  value={draft.handle}
                  maxLength={16}
                  onChange={(e) => setDraft((d) => ({ ...d, handle: e.target.value }))}
                  className={`${inputCls} pl-7`}
                  placeholder="5201314"
                />
              </div>
            </Field>
            <Field label="文案">
              <textarea
                value={draft.text}
                maxLength={40}
                rows={2}
                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                className={`${inputCls} resize-none leading-[19px]`}
                placeholder="写点什么…"
              />
            </Field>
          </div>
        </div>

        {/* 隐藏文件选择器（放在底部弹层内部：合成 click 只冒泡到已 stopPropagation 的弹层，
            不会触达遮罩 onClick 导致编辑弹窗提前关闭） */}
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              fileToScaledDataURL(file, 256, 0.85)
                .then((u) => setDraft((d) => ({ ...d, avatar: u })))
                .catch(() => undefined);
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
