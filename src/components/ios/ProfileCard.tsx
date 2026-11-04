'use client';

import { useRef, useState } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { MapPin } from 'lucide-react';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';

/** 信息卡片小组件数据（第二页顶部的个人名片卡片） */
export interface ProfileCardData {
  /** 昵称 */
  name: string;
  /** 账号（不带 @ 前缀存储） */
  handle: string;
  /** 个性签名（可空） */
  bio: string;
  /** 位置（可空） */
  loc: string;
  /** 头像 dataURL；null = 用内置默认图 */
  avatar: string | null;
  /** 背景图 dataURL；null = 用内置默认图 */
  bg: string | null;
}

/** 存储键（v2：默认内容/素材更换后升版，旧 v1 自定义数据作废，新默认内容生效） */
export const PROFILE_CARD_KEY = 'home.profileCard.v2';
export const PROFILE_AVATAR_DEFAULT = '/images/profile-avatar.png';
export const PROFILE_BG_DEFAULT = '/images/profile-bg.png';

/** 默认内容（用户指定：头像/背景图用其上传图片，文字信息按其提供内容；均可在编辑器里修改） */
export const DEFAULT_PROFILE_CARD: ProfileCardData = {
  name: 'Angelina',
  handle: 'woaini520',
  bio: '☆*:.爱 是唯一通向你的次元的钥匙☆*',
  loc: '冰岛',
  avatar: null,
  bg: null,
};

/** 读取持久化的信息卡片数据（损坏/缺失时回退默认值） */
export function loadProfileCard(): ProfileCardData {
  try {
    const p = kvGet<Partial<ProfileCardData>>(PROFILE_CARD_KEY);
    if (!p) return DEFAULT_PROFILE_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    return {
      name: str(p.name, DEFAULT_PROFILE_CARD.name),
      handle: str(p.handle, DEFAULT_PROFILE_CARD.handle).replace(/^@+/, ''),
      bio: str(p.bio, ''),
      loc: str(p.loc, ''),
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
      bg: typeof p.bg === 'string' ? p.bg : null,
    };
  } catch {
    return DEFAULT_PROFILE_CARD;
  }
}

/** 图片文件 → 压缩 dataURL（最长边 maxEdge，JPEG 质量 quality），控制 localStorage 体积 */
export function fileToScaledDataURL(file: File, maxEdge: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / img.width, maxEdge / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('压缩失败'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    img.src = url;
  });
}

/** 卡片可视内容（顶部通栏 3 行槽位 ≈342×260 满格：背景图 + 骑缝大圆头像 + 名字/账号/签名/位置）。
 *  由 2×2（159×168）升级为通栏整行大名片；深浅主题自适应（浅色=白卡黑字、深色=黑卡白字）。 */
export function ProfileCardWidget({ data }: { data: ProfileCardData }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  return (
    <div
      className={`relative h-[260px] w-full select-none overflow-hidden rounded-[24px] ring-1 ${
        dark ? 'text-white ring-white/10' : 'text-[#161618] ring-black/10'
      }`}
    >
      {/* 背景图（上部）：高度向下多延伸一段（用户要求「往下移一点点」）——
          让背景图的下边缘完全藏到白色面板后面，否则白色面板顶部圆角
          与背景图下边缘之间会露出背景图下面的两个方角 */}
      <div className="absolute inset-x-0 top-0 h-[164px] overflow-hidden">
        <img
          src={data.bg || PROFILE_BG_DEFAULT}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
      </div>
      {/* 卡片主体面板（白色部分）：顶部两角圆角，像一张圆角面板叠在背景图上（用户要求） */}
      <div
        data-testid="profile-card-body"
        className={`absolute inset-x-0 bottom-0 top-[126px] rounded-t-[24px] ${dark ? 'bg-[#151517]' : 'bg-white/95'}`}
      />
      {/* 圆头像（骑在背景图与面板交界；描边颜色随卡片底色） */}
      <img
        src={data.avatar || PROFILE_AVATAR_DEFAULT}
        alt="头像"
        draggable={false}
        className={`absolute left-1/2 top-[108px] h-[64px] w-[64px] -translate-x-1/2 select-none rounded-full border-[3px] object-cover ${
          dark ? 'border-[#151517]' : 'border-white'
        }`}
      />
      {/* 文字区 */}
      <div className="absolute inset-x-0 top-[182px] flex flex-col items-center gap-[3px] px-4 text-center">
        <p className="max-w-full truncate text-[16px] font-bold leading-[18px]">{data.name}</p>
        {data.handle && (
          <p className={`max-w-full truncate text-[12px] leading-[13px] ${dark ? 'text-white/50' : 'text-black/45'}`}>
            @{data.handle}
          </p>
        )}
        {data.bio && (
          <p className={`max-w-full truncate text-[12px] leading-[14px] ${dark ? 'text-white/85' : 'text-black/75'}`}>
            {data.bio}
          </p>
        )}
        {data.loc && (
          <p className={`flex max-w-full items-center gap-[4px] text-[11px] leading-[12px] ${dark ? 'text-white/55' : 'text-black/50'}`}>
            <MapPin className="h-[11px] w-[11px] shrink-0" aria-hidden="true" />
            <span className="truncate">{data.loc}</span>
          </p>
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

/** 编辑器（主屏根层级底部弹窗）：换头像 / 换背景图 / 改文字，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），因此草稿直接用当前数据初始化。 */
export function ProfileCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: ProfileCardData;
  onClose: () => void;
  onSave: (d: ProfileCardData) => void;
}) {
  const [draft, setDraft] = useState<ProfileCardData>(data);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const bgInput = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：文件选择器打开前后的一小段时间内忽略遮罩点击——
   *  ① input.click() 的合成 click 会冒泡（老 bug：点「更换头像」弹窗立即关闭）；
   *  ② 移动端真机选完图关掉系统弹窗后会有幽灵 click 落在遮罩上，同样会误关弹窗 */
  const pickGuardUntil = useRef(0);

  const openPicker = (input: HTMLInputElement | null) => {
    pickGuardUntil.current = Date.now() + 1500;
    input?.click();
  };

  const pickImage = (file: File | undefined, maxEdge: number, quality: number, apply: (u: string) => void) => {
    if (!file) return;
    fileToScaledDataURL(file, maxEdge, quality)
      .then(apply)
      .catch(() => undefined);
  };

  const save = () => {
    const clean = (s: string) => s.trim();
    onSave({
      name: clean(draft.name) || DEFAULT_PROFILE_CARD.name,
      handle: clean(draft.handle).replace(/^@+/, ''),
      bio: clean(draft.bio),
      loc: clean(draft.loc),
      avatar: draft.avatar,
      bg: draft.bg,
    });
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑信息卡片"
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
            <p className="text-[15px] font-semibold">编辑信息卡片</p>
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
                src={draft.avatar || PROFILE_AVATAR_DEFAULT}
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

            {/* 背景图 */}
            <div className="flex items-center gap-3">
              <img
                src={draft.bg || PROFILE_BG_DEFAULT}
                alt="背景预览"
                className="h-[52px] w-[92px] shrink-0 rounded-[10px] object-cover ring-1 ring-white/15"
              />
              <div className="flex flex-col items-start gap-[6px]">
                <button
                  type="button"
                  onClick={() => openPicker(bgInput.current)}
                  className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
                >
                  更换背景图
                </button>
                {draft.bg && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, bg: null }))}
                    className="text-[11px] text-white/50 transition-colors active:text-white/80"
                  >
                    恢复默认背景
                  </button>
                )}
              </div>
            </div>

            {/* 文字字段 */}
            <Field label="名字">
              <input value={draft.name} maxLength={16} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={inputCls} placeholder="昵称" />
            </Field>
            <Field label="账号">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-white/45">@</span>
                <input
                  value={draft.handle}
                  maxLength={16}
                  onChange={(e) => setDraft((d) => ({ ...d, handle: e.target.value }))}
                  className={`${inputCls} pl-7`}
                  placeholder="账号名"
                />
              </div>
            </Field>
            <Field label="个性签名">
              <input
                value={draft.bio}
                maxLength={40}
                onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                className={inputCls}
                placeholder="写一句签名…"
              />
            </Field>
            <Field label="位置">
              <input
                value={draft.loc}
                maxLength={16}
                onChange={(e) => setDraft((d) => ({ ...d, loc: e.target.value }))}
                className={inputCls}
                placeholder="如：佛罗伦萨"
              />
            </Field>
          </div>
        </div>

        {/* 隐藏文件选择器（必须放在底部弹层内部：input.click() 的合成 click 只冒泡到弹层
            （内部已 stopPropagation），不会再触达遮罩 onClick 导致编辑弹窗提前关闭） */}
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            pickImage(e.target.files?.[0], 256, 0.85, (u) => setDraft((d) => ({ ...d, avatar: u })));
            e.target.value = '';
          }}
        />
        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            pickImage(e.target.files?.[0], 720, 0.8, (u) => setDraft((d) => ({ ...d, bg: u })));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
