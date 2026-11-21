'use client';

/**
 * iCity 风格小组件（col-span-2 方格 ≈159×168）：半透明深灰圆角卡片——
 * 左上 = 名字（编辑器可改名，默认 icity）；下方 = 「MM月DD日 星期X」；
 * 底部 = 胶囊条（圆头像 + 一句话，头像/文字均可在编辑器修改——用户参考图）。
 * 点击（主屏）打开编辑弹层；数据经 idb-kv 写穿 IndexedDB（本地持久化），图片经 canvas 压缩控制体积。
 * 深色半透明实体底不随主题/壁纸翻转（任何壁纸上都清晰，与 iOS 实体图标同理）。
 */
import { useRef, useState, useEffect } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { fileToScaledDataURL } from './ProfileCard';

/** iCity 小组件数据 */
export interface ICityCardData {
  /** 左上角名字（默认 icity） */
  name: string;
  /** 底部胶囊里的一句话（默认「写点什么」） */
  note: string;
  /** 头像 dataURL；null = 用内置默认图 */
  avatar: string | null;
}

/** 存储键（v1） */
export const ICITY_CARD_KEY = 'home.icityCard.v1';
export const ICITY_AVATAR_DEFAULT = '/images/profile-avatar.png';

export const DEFAULT_ICITY_CARD: ICityCardData = { name: 'icity', note: '写点什么', avatar: null };

/** 读取持久化数据（损坏/缺失时回退默认值） */
export function loadICityCard(): ICityCardData {
  try {
    const p = kvGet<Partial<ICityCardData>>(ICITY_CARD_KEY);
    if (!p) return DEFAULT_ICITY_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    return {
      name: str(p.name, DEFAULT_ICITY_CARD.name),
      note: str(p.note, DEFAULT_ICITY_CARD.note),
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
    };
  } catch {
    return DEFAULT_ICITY_CARD;
  }
}

/** 可视内容（日期 SSR 首帧留空避免水合不一致，挂载后立即填充、每 10s 刷新） */
export function ICityCardWidget({ data }: { data: ICityCardData }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const iv = window.setInterval(tick, 10_000);
    return () => window.clearInterval(iv);
  }, []);
  const dateText = now
    ? `${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 星期${'日一二三四五六'[now.getDay()]}`
    : '';
  return (
    <div className="relative h-[168px] w-full select-none overflow-hidden rounded-[22px] bg-[#58585c]/70 ring-1 ring-white/15 backdrop-blur-xl">
      <p className="absolute left-4 top-[13px] max-w-[calc(100%-32px)] truncate text-[23px] font-extrabold leading-none tracking-tight text-white/95">
        {data.name}
      </p>
      <p className="absolute left-4 top-[62px] text-[13px] leading-none text-white/55">{dateText}</p>
      {/* 底部胶囊：头像 + 一句话 */}
      <div className="absolute inset-x-3 bottom-[13px] flex h-[44px] items-center gap-[9px] rounded-full bg-white/25 pl-[5px] pr-3 backdrop-blur-sm">
        <img
          src={data.avatar || ICITY_AVATAR_DEFAULT}
          alt="头像"
          draggable={false}
          className="h-[35px] w-[35px] shrink-0 select-none rounded-full object-cover"
        />
        <p className="min-w-0 truncate text-[14px] leading-none text-white/85">{data.note}</p>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-[10px] bg-white/10 px-3 py-[8px] text-[14px] text-white outline-none ring-1 ring-white/10 transition-colors placeholder:text-white/35 focus:bg-white/15 focus:ring-white/20';

/** 编辑器（主屏根层级底部弹窗）：改名字 / 换头像 / 改胶囊一句话，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），因此草稿直接用当前数据初始化。 */
export function ICityCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: ICityCardData;
  onClose: () => void;
  onSave: (d: ICityCardData) => void;
}) {
  const [draft, setDraft] = useState<ICityCardData>(data);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：input.click() 合成 click 会冒泡、真机选图后有幽灵 click——段时间窗内忽略遮罩点击 */
  const pickGuardUntil = useRef(0);

  const openPicker = (input: HTMLInputElement | null) => {
    pickGuardUntil.current = Date.now() + 1500;
    input?.click();
  };

  const save = () => {
    onSave({
      name: draft.name.trim() || DEFAULT_ICITY_CARD.name,
      note: draft.note.trim() || DEFAULT_ICITY_CARD.note,
      avatar: draft.avatar,
    });
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑 iCity 小组件"
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
            <p className="text-[15px] font-semibold">编辑 iCity</p>
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
                src={draft.avatar || ICITY_AVATAR_DEFAULT}
                alt="头像预览"
                className="h-[52px] w-[52px] shrink-0 rounded-full object-cover ring-1 ring-white/15"
              />
              <div className="flex flex-col items-start gap-[6px]">
                <button
                  type="button"
                  onClick={() => openPicker(avatarInput.current)}
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
            <label className="block">
              <span className="mb-[6px] block text-[12px] font-medium text-white/55">名字</span>
              <input
                value={draft.name}
                maxLength={16}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className={inputCls}
                placeholder="icity"
              />
            </label>
            <label className="block">
              <span className="mb-[6px] block text-[12px] font-medium text-white/55">胶囊文字</span>
              <input
                value={draft.note}
                maxLength={24}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                className={inputCls}
                placeholder="写点什么"
              />
            </label>
          </div>
        </div>

        {/* 隐藏文件选择器（放在弹层内部：合成 click 只冒泡到弹层，不会误触遮罩关弹窗） */}
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            fileToScaledDataURL(f, 256, 0.85)
              .then((u) => setDraft((d) => ({ ...d, avatar: u })))
              .catch(() => undefined);
          }}
        />
      </div>
    </div>
  );
}
