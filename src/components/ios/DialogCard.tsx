'use client';

import { useRef, useState } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { fileToScaledDataURL } from './ProfileCard';

/**
 * 对话气泡小组件（第四页 4×2 通栏，用户参考图样式）：
 * 左右两张白圈圆头像，中间两个交错的半透明描边聊天气泡（右上一句 / 左下一句，
 * 形成一问一答的对话感）——透明底直接浮在壁纸上，无边框无投影（与其它小组件一致）。
 * 头像与两句气泡文字均可在编辑器里修改；数据经 idb-kv 写穿 IndexedDB（本地持久化）。
 */

/** 对话气泡小组件数据 */
export interface DialogCardData {
  /** 第一句（右对齐气泡，右上） */
  text1: string;
  /** 第二句（左对齐气泡，左下） */
  text2: string;
  /** 左头像 dataURL；null = 内置默认图 */
  avatar1: string | null;
  /** 右头像 dataURL；null = 内置默认图 */
  avatar2: string | null;
}

/** 对话气泡小组件存储 key（v2：默认头像换用户仓鼠图 + 文案更新，旧数据作废） */
export const DIALOG_CARD_KEY = 'home.dialogCard.v2';
/** 左头像默认图：用户图「该用户很安详」仓鼠 */
export const DIALOG_AVATAR_LEFT = '/images/couple-cat-peace.png';
/** 右头像默认图：用户图「该用户长得太萌无法查看」天使仓鼠 */
export const DIALOG_AVATAR_RIGHT = '/images/couple-cat-cute.png';

/** 默认内容（用户指定文案：右=你我相遇枯木逢春，左=我們相加 世界等於零） */
export const DEFAULT_DIALOG_CARD: DialogCardData = {
  text1: '你我相遇枯木逢春',
  text2: '我們相加 世界等於零',
  avatar1: null,
  avatar2: null,
};

/** 读取持久化的对话气泡数据（损坏/缺失时回退默认值） */
export function loadDialogCard(): DialogCardData {
  try {
    const p = kvGet<Partial<DialogCardData>>(DIALOG_CARD_KEY);
    if (!p) return DEFAULT_DIALOG_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    return {
      text1: str(p.text1, DEFAULT_DIALOG_CARD.text1),
      text2: str(p.text2, DEFAULT_DIALOG_CARD.text2),
      avatar1: typeof p.avatar1 === 'string' ? p.avatar1 : null,
      avatar2: typeof p.avatar2 === 'string' ? p.avatar2 : null,
    };
  } catch {
    return DEFAULT_DIALOG_CARD;
  }
}

/** 单个白圈圆头像 */
function Head({ src, alt, className }: { src: string; alt: string; className: string }) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`absolute h-[58px] w-[58px] select-none rounded-full object-cover ring-2 ring-white/90 ${className}`}
    />
  );
}

/** 卡片可视内容（4×2 通栏槽位 ≈326×168 满格）：双头像 + 交错双气泡 */
export function DialogCardWidget({ data }: { data: DialogCardData }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  const bubbleCls = dark
    ? 'bg-white/[0.16] ring-white/30 text-white'
    : 'bg-white/50 ring-black/[0.08] text-[#2c2c2e]';
  return (
    <div className="relative h-[168px] w-full select-none">
      {/* 左右头像（垂直居中） */}
      <Head src={data.avatar1 || DIALOG_AVATAR_LEFT} alt="左头像" className="left-[14px] top-[46px]" />
      <Head src={data.avatar2 || DIALOG_AVATAR_RIGHT} alt="右头像" className="right-[14px] top-[46px]" />

      {/* 第一句：右对齐气泡（右上，右头像一侧） */}
      <div className={`absolute right-[84px] top-[26px] z-[1] max-w-[200px] rounded-[15px] px-[12px] py-[7px] ring-1 backdrop-blur-[3px] ${bubbleCls}`}>
        {data.text1 ? (
          <p className="line-clamp-2 break-all text-right text-[12px] font-semibold leading-[16px]">{data.text1}</p>
        ) : (
          <p className="text-right text-[12px] leading-[16px] opacity-50">说点什么…</p>
        )}
      </div>

      {/* 第二句：左对齐气泡（左下，左头像一侧） */}
      <div className={`absolute left-[84px] top-[96px] z-[1] max-w-[200px] rounded-[15px] px-[12px] py-[7px] ring-1 backdrop-blur-[3px] ${bubbleCls}`}>
        {data.text2 ? (
          <p className="line-clamp-2 break-all text-[12px] font-semibold leading-[16px]">{data.text2}</p>
        ) : (
          <p className="text-[12px] leading-[16px] opacity-50">说点什么…</p>
        )}
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

/** 头像选择行（更换/恢复默认，pickGuard 防弹窗提前关闭——与一起听编辑器同款交互） */
function AvatarRow({
  label,
  src,
  fallback,
  onPick,
  onReset,
}: {
  label: string;
  src: string;
  fallback: string;
  onPick: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <img src={src} alt={`${label}预览`} className="h-[48px] w-[48px] shrink-0 rounded-full object-cover ring-1 ring-white/15" />
      <div className="flex flex-col items-start gap-[6px]">
        <span className="text-[12px] font-medium text-white/55">{label}</span>
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            onClick={onPick}
            className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
          >
            更换头像
          </button>
          {src !== fallback && (
            <button type="button" onClick={onReset} className="text-[11px] text-white/50 transition-colors active:text-white/80">
              恢复默认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 编辑器（主屏根层级底部弹窗）：换双头像 / 改两句气泡文字，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），草稿用当前数据初始化。 */
export function DialogCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: DialogCardData;
  onClose: () => void;
  onSave: (d: DialogCardData) => void;
}) {
  const [draft, setDraft] = useState<DialogCardData>(data);
  const input1 = useRef<HTMLInputElement | null>(null);
  const input2 = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：开选图器后 1.5s 内忽略遮罩点击（防合成/幽灵 click 误关弹窗） */
  const pickGuardUntil = useRef(0);

  const pick = (which: 1 | 2) => {
    pickGuardUntil.current = Date.now() + 1500;
    (which === 1 ? input1 : input2).current?.click();
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

  const save = () => {
    const clean = (s: string) => s.trim();
    onSave({
      ...draft,
      text1: clean(draft.text1),
      text2: clean(draft.text2),
    });
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑对话气泡"
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
            <p className="text-[15px] font-semibold">编辑对话气泡</p>
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-white px-4 py-[5px] text-[14px] font-semibold text-black transition-transform active:scale-95"
            >
              保存
            </button>
          </div>

          <div className="no-scrollbar max-h-[46vh] space-y-4 overflow-y-auto pr-0.5">
            <AvatarRow
              label="左边头像"
              src={draft.avatar1 || DIALOG_AVATAR_LEFT}
              fallback={DIALOG_AVATAR_LEFT}
              onPick={() => pick(1)}
              onReset={() => setDraft((d) => ({ ...d, avatar1: null }))}
            />
            <AvatarRow
              label="右边头像"
              src={draft.avatar2 || DIALOG_AVATAR_RIGHT}
              fallback={DIALOG_AVATAR_RIGHT}
              onPick={() => pick(2)}
              onReset={() => setDraft((d) => ({ ...d, avatar2: null }))}
            />
            <Field label="上面气泡（右）">
              <input
                value={draft.text1}
                maxLength={20}
                onChange={(e) => setDraft((d) => ({ ...d, text1: e.target.value }))}
                className={inputCls}
                placeholder="你我相遇枯木逢春"
              />
            </Field>
            <Field label="下面气泡（左）">
              <input
                value={draft.text2}
                maxLength={20}
                onChange={(e) => setDraft((d) => ({ ...d, text2: e.target.value }))}
                className={inputCls}
                placeholder="我們相加 世界等於零"
              />
            </Field>
          </div>
        </div>

        {/* 隐藏文件选择器（放在底部弹层内部：合成 click 只冒泡到已 stopPropagation 的弹层） */}
        <input ref={input1} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(1)} />
        <input ref={input2} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(2)} />
      </div>
    </div>
  );
}
