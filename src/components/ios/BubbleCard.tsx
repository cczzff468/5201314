'use client';

import { useRef, useState } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { fileToScaledDataURL } from './ProfileCard';

/**
 * 气泡小组件（第二页 2×2 方格）：两个头像并排，每个头像头顶各有一个聊天气泡
 * （尾巴朝下指向头像）。用户要求去掉小组件外面的边框——现在不带卡片底/描边，
 * 白色气泡 + 圆头像直接浮在壁纸上（与第三页一起听小组件同款浮动风格）。
 * 头像与气泡文字都可在编辑器里分别修改；数据经 idb-kv 写穿 IndexedDB（本地持久化）。
 */

/** 气泡小组件数据：左右两个气泡文字 + 左右两个头像（null = 用内置默认图） */
export interface BubbleCardData {
  /** 左边（我）头顶气泡的文字 */
  left: string;
  /** 右边头顶气泡的文字 */
  right: string;
  /** 左侧头像 dataURL；null = 内置默认图 */
  avatar1: string | null;
  /** 右侧头像 dataURL；null = 内置默认图 */
  avatar2: string | null;
}

/** v3：头像可更换（旧 v2 数据作废回默认值，默认头像/文案按用户要求更新） */
export const BUBBLE_CARD_KEY = 'home.bubbleCard.v3';
/** 左侧头像（我）默认图：用户指定的「该用户很安详」猫咪 */
export const BUBBLE_AVATAR_ME = '/images/couple-cat-peace.png';
/** 右侧头像默认图：用户指定的「该用户长得太萌无法查看」猫咪 */
export const BUBBLE_AVATAR_HER = '/images/couple-cat-cute.png';

/** 默认内容（用户指定：气泡文字 在干嘛 / 想你） */
export const DEFAULT_BUBBLE_CARD: BubbleCardData = {
  left: '在干嘛',
  right: '想你',
  avatar1: null,
  avatar2: null,
};

/** 读取持久化的气泡数据（损坏/缺失时回退默认值） */
export function loadBubbleCard(): BubbleCardData {
  try {
    const p = kvGet<Partial<BubbleCardData>>(BUBBLE_CARD_KEY);
    if (!p) return DEFAULT_BUBBLE_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    return {
      left: str(p.left, DEFAULT_BUBBLE_CARD.left),
      right: str(p.right, DEFAULT_BUBBLE_CARD.right),
      avatar1: typeof p.avatar1 === 'string' ? p.avatar1 : null,
      avatar2: typeof p.avatar2 === 'string' ? p.avatar2 : null,
    };
  } catch {
    return DEFAULT_BUBBLE_CARD;
  }
}

/** 单个「气泡 + 头像」列：白色气泡在头顶、尾巴朝下指向头像，整体浮在壁纸上 */
function BubbleAvatarColumn({ text, avatar, alt }: { text: string; avatar: string; alt: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      {/* 气泡（居中 + 底部中央小尾巴指向下方头像） */}
      <div className="relative z-[1] w-fit max-w-full">
        {/* 白色气泡 + 轻描边（浅色壁纸上保持边界清晰；深色壁纸下描边几乎不可见、白泡自然浮起） */}
        <div className="rounded-[13px] bg-white px-[9px] py-[6px] text-center ring-1 ring-black/[0.07]">
          {text ? (
            <p className="line-clamp-2 break-all text-[11px] leading-[14px] text-[#161618]">{text}</p>
          ) : (
            <p className="text-[11px] leading-[14px] text-black/30">说点什么…</p>
          )}
        </div>
        <span
          aria-hidden="true"
          className="absolute -bottom-[3px] left-1/2 h-[8px] w-[8px] -translate-x-1/2 rotate-45 rounded-[2px] bg-white"
        />
      </div>
      {/* 头像（白描边圆头像，参考图样式） */}
      <img
        src={avatar}
        alt={alt}
        draggable={false}
        className="mt-[7px] h-[44px] w-[44px] select-none rounded-full object-cover ring-2 ring-white/90"
      />
    </div>
  );
}

/** 卡片可视内容（2×2 方格槽位 ≈171×168 满格）：左右两组「头顶气泡 + 头像」并排，无边框无卡片底 */
export function BubbleCardWidget({ data }: { data: BubbleCardData }) {
  return (
    <div className="flex h-[168px] w-full select-none items-center justify-center overflow-hidden px-[8px]">
      <div className="flex w-full items-center justify-center gap-[10px]">
        <BubbleAvatarColumn text={data.left} avatar={data.avatar1 || BUBBLE_AVATAR_ME} alt="我的头像" />
        <BubbleAvatarColumn text={data.right} avatar={data.avatar2 || BUBBLE_AVATAR_HER} alt="TA 的头像" />
      </div>
    </div>
  );
}

const textareaCls =
  'w-full resize-none rounded-[10px] bg-white/10 px-3 py-[8px] text-[14px] leading-[19px] text-white outline-none ring-1 ring-white/10 transition-colors placeholder:text-white/35 focus:bg-white/15 focus:ring-white/20';

/** 头像选择行：预览 + 更换 + 恢复默认 */
function AvatarPickerRow({
  label,
  value,
  fallback,
  onPick,
  onReset,
  onOpenPicker,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onPick: (u: string) => void;
  onReset: () => void;
  onOpenPicker: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <img
        src={value || fallback}
        alt={`${label}预览`}
        className="h-[48px] w-[48px] shrink-0 rounded-full object-cover ring-1 ring-white/15"
      />
      <div className="flex flex-col items-start gap-[6px]">
        <span className="text-[12px] font-medium text-white/55">{label}</span>
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            onClick={onOpenPicker}
            className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
          >
            更换头像
          </button>
          {value && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-white/50 transition-colors active:text-white/80"
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 编辑器（主屏根层级底部弹窗）：换左右头像 / 改左右气泡文字，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），草稿直接用当前数据初始化。 */
export function BubbleCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: BubbleCardData;
  onClose: () => void;
  onSave: (d: BubbleCardData) => void;
}) {
  const [draft, setDraft] = useState<BubbleCardData>(data);
  const avatar1Input = useRef<HTMLInputElement | null>(null);
  const avatar2Input = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：input.click() 的合成 click / 系统选图器关闭后的幽灵 click 会误关弹窗
   *  （与信息卡片/日记编辑器同款防护），开选图器后 1.5s 内忽略遮罩点击 */
  const pickGuardUntil = useRef(0);

  const pick = (which: 1 | 2) => {
    pickGuardUntil.current = Date.now() + 1500;
    (which === 1 ? avatar1Input : avatar2Input).current?.click();
  };

  const onFile = (which: 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileToScaledDataURL(file, 256, 0.85)
        .then((u) => setDraft((d) => (which === 1 ? { ...d, avatar1: u } : { ...d, avatar2: u })))
        .catch(() => undefined);
    }
    e.target.value = '';
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑气泡"
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
            <p className="text-[15px] font-semibold">编辑气泡</p>
            <button
              type="button"
              onClick={() => onSave({ left: draft.left.trim(), right: draft.right.trim(), avatar1: draft.avatar1, avatar2: draft.avatar2 })}
              className="rounded-full bg-white px-4 py-[5px] text-[14px] font-semibold text-black transition-transform active:scale-95"
            >
              保存
            </button>
          </div>

          <div className="no-scrollbar max-h-[46vh] space-y-4 overflow-y-auto pr-0.5">
            {/* 左右头像（可更换） */}
            <AvatarPickerRow
              label="左边头像（我）"
              value={draft.avatar1}
              fallback={BUBBLE_AVATAR_ME}
              onPick={(u) => setDraft((d) => ({ ...d, avatar1: u }))}
              onReset={() => setDraft((d) => ({ ...d, avatar1: null }))}
              onOpenPicker={() => pick(1)}
            />
            <AvatarPickerRow
              label="右边头像"
              value={draft.avatar2}
              fallback={BUBBLE_AVATAR_HER}
              onPick={(u) => setDraft((d) => ({ ...d, avatar2: u }))}
              onReset={() => setDraft((d) => ({ ...d, avatar2: null }))}
              onOpenPicker={() => pick(2)}
            />

            <label className="block">
              <span className="mb-[6px] block text-[12px] font-medium text-white/55">左边气泡（我）</span>
              <textarea
                value={draft.left}
                maxLength={16}
                rows={2}
                onChange={(e) => setDraft((d) => ({ ...d, left: e.target.value }))}
                className={textareaCls}
                placeholder="想说的话…"
              />
              <span className="mt-[6px] block text-right text-[11px] text-white/35">{draft.left.length}/16</span>
            </label>
            <label className="block">
              <span className="mb-[6px] block text-[12px] font-medium text-white/55">右边气泡</span>
              <textarea
                value={draft.right}
                maxLength={16}
                rows={2}
                onChange={(e) => setDraft((d) => ({ ...d, right: e.target.value }))}
                className={textareaCls}
                placeholder="想说的话…"
              />
              <span className="mt-[6px] block text-right text-[11px] text-white/35">{draft.right.length}/16</span>
            </label>
          </div>
        </div>

        {/* 隐藏文件选择器（放在底部弹层内部：合成 click 只冒泡到已 stopPropagation 的弹层，
            不会触达遮罩 onClick 导致编辑弹窗提前关闭） */}
        <input ref={avatar1Input} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(1)} />
        <input ref={avatar2Input} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(2)} />
      </div>
    </div>
  );
}
