'use client';

/**
 * X论坛 · 编辑资料弹层（X Edit profile 全屏 sheet）。
 *
 * 槽位隔离语义（与微信/QQ 头像三入口同口径，用户指定）：
 * - 未编辑/已清除的字段跟随全局（设置›个人信息的机主名与头像；
 *   全局头像也没有时 → XAvatar 默认头像图）；
 * - 在这里编辑保存过 → X论坛内一直使用这里的值，不再随全局变化；
 * - 每项可单独「移除」恢复跟随全局，底部另有一键全部恢复。
 *
 * 可编辑：头像与背景图（均从手机上传；背景图居中裁剪 3:1）、名字、账号（默认 @qvq12345678）、简介。
 * 「正在关注/关注者」已按用户要求移除编辑入口，始终跟随真实数据。
 */

import { useRef, useState } from 'react';
import { Camera, ImagePlus, RotateCcw, Trash2, VenetianMask } from 'lucide-react';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
import {
  ANON_KEY,
  forumData,
  ownerGlobalProfile,
  resolveAuthor,
  saveForumProfile,
  DEFAULT_USER_HANDLE,
} from '@/lib/forum/core';
import { useForum } from './ctx';

/** 背景图文件 → dataURL（居中裁剪 3:1 → 900×300 JPEG q0.85；主页横幅 object-cover 直出） */
export function fileToBannerDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = 900;
        const h = 300;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/** X 风格字段行：小灰标签在上 + 底边框输入框 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputMode?: 'text' | 'numeric';
  maxLength?: number;
  ariaLabel: string;
}) {
  const f = useForum();
  const t = f.t;
  return (
    <div className="border-b px-4 pb-2 pt-4" style={{ borderColor: t.border }}>
      <label className="block text-[12px] font-medium" style={{ color: t.secondary }} htmlFor={`fe-${label}`}>
        {label}
      </label>
      <input
        id={`fe-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className="mt-1 w-full bg-transparent text-[17px] font-bold outline-none"
        style={{ color: t.text, caretColor: t.blue }}
      />
    </div>
  );
}

/** 编辑资料弹层：大号（account='main'，缺省）与匿名小号（account='anon'）各自隔离的资料。
 *  大号：槽位隔离语义（未编辑字段跟随全局机主资料）；
 *  小号：独立身份——未编辑字段用小号自己的随机默认（网名/handle/头像），
 *  与大号/全局零关联（AI 认知隔离的根基：资料里不出现任何机主痕迹）。 */
export function EditProfileSheet({ account = 'main', onClose }: { account?: 'main' | 'anon'; onClose: () => void }) {
  const f = useForum();
  const t = f.t;
  const d = forumData();
  const isAnon = account === 'anon';
  const gp = ownerGlobalProfile();
  const anonAuthor = resolveAuthor(ANON_KEY);
  // 小号预览/占位：小号当前身份（默认或自定义）；大号预览：自定义 → 全局
  const fp = isAnon ? (d.anon?.profile ?? {}) : (d.profile ?? {});

  const [name, setName] = useState(fp.name ?? '');
  const [handle, setHandle] = useState(fp.handle ?? '');
  const [bio, setBio] = useState(fp.bio ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(fp.avatar ?? undefined);
  const [banner, setBanner] = useState<string | undefined>(fp.banner ?? undefined);
  const avatarRef = useRef<HTMLInputElement | null>(null);
  const bannerRef = useRef<HTMLInputElement | null>(null);

  /** 头像预览：小号 = 自定义 → 小号默认（头像库随机图）；大号 = 自定义 → 全局 → 默认头像图 */
  const previewAvatar = isAnon ? (avatar ?? anonAuthor.avatar) : (avatar ?? gp.avatar);
  const hasCustom = Boolean(fp.name || fp.handle || fp.bio || fp.avatar || fp.banner);
  /** 账号默认值：大号 @qvq12345678（用户指定）；小号 = 创建时随机生成的 handle */
  const handleFallback = isAnon ? anonAuthor.handle : DEFAULT_USER_HANDLE;
  /** 名字占位：小号默认随机网名；大号跟随全局机主名 */
  const namePlaceholder = isAnon ? `默认（${anonAuthor.name}）` : `跟随全局（${gp.name}）`;

  const onAvatarFile = (file: File | undefined) => {
    if (!file) return;
    fileToAvatarDataUrl(file)
      .then((dataUrl) => {
        setAvatar(dataUrl);
        f.toast('新头像已就绪，点「保存」生效');
      })
      .catch(() => f.toast('图片处理失败，换一张试试'));
  };

  const onBannerFile = (file: File | undefined) => {
    if (!file) return;
    fileToBannerDataUrl(file)
      .then((dataUrl) => {
        setBanner(dataUrl);
        f.toast('新背景图已就绪，点「保存」生效');
      })
      .catch(() => f.toast('图片处理失败，换一张试试'));
  };

  /** 账号输入清洗：不允许 @ 与空白（保存时再清洗一次） */
  const onHandleChange = (v: string) => {
    setHandle(v.replace(/@+/g, '').replace(/\s+/g, '').slice(0, 20));
  };

  const save = () => {
    saveForumProfile(
      {
        name: name.trim() || undefined,
        handle: handle.trim() || undefined,
        bio: bio.trim() || undefined,
        avatar,
        banner,
      },
      account,
    );
    f.toast(isAnon ? '匿名账号资料已保存' : '资料已保存');
    onClose();
  };

  const resetAll = () => {
    saveForumProfile(
      {
        name: undefined,
        handle: undefined,
        bio: undefined,
        avatar: undefined,
        banner: undefined,
      },
      account,
    );
    f.toast(isAnon ? '已恢复匿名账号的默认身份' : '已清除全部自定义，恢复跟随全局');
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="编辑资料">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：取消 | 编辑资料（匿名小号）/ 编辑资料 | 保存（X Edit profile 三段式） */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            onClick={onClose}
            className="text-[15px] font-medium active:opacity-60"
            style={{ color: t.blue }}
          >
            取消
          </button>
          <span className="flex items-center gap-1.5 text-[17px] font-bold">
            {isAnon && <VenetianMask width={17} height={17} strokeWidth={2.1} aria-hidden="true" />}
            {isAnon ? '编辑匿名账号' : '编辑资料'}
          </span>
          <button
            type="button"
            onClick={save}
            className="flex h-[32px] items-center rounded-full px-5 text-[14px] font-bold text-white transition-opacity active:opacity-70"
            style={{ background: t.blue }}
          >
            保存
          </button>
        </div>

        <div className="forum-hide-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-10">
          {/* 背景图（从手机上传，3:1 裁剪） */}
          <div
            className="relative h-[130px] w-full shrink-0 overflow-hidden"
            style={banner ? undefined : { background: `linear-gradient(135deg, ${t.blue}, #0f5f8f)` }}
          >
            {banner && <img src={banner} alt="背景图预览" className="h-full w-full object-cover" />}
            <button
              type="button"
              onClick={() => bannerRef.current?.click()}
              className="absolute inset-0 m-auto flex h-[34px] w-fit items-center gap-2 rounded-full bg-black/50 px-4 text-[13px] font-semibold text-white backdrop-blur-sm transition-opacity active:opacity-70"
              style={{ color: '#fff' }}
            >
              <Camera width={16} height={16} strokeWidth={2} aria-hidden="true" />
              {banner ? '更换背景图' : '从手机上传背景图'}
            </button>
            {banner && (
              <button
                type="button"
                onClick={() => setBanner(undefined)}
                aria-label="移除背景图"
                className="absolute right-3 top-3 flex h-[30px] items-center gap-1 rounded-full bg-black/50 px-3 text-[12px] font-semibold text-white backdrop-blur-sm transition-opacity active:opacity-70"
                style={{ color: '#fff' }}
              >
                <Trash2 width={13} height={13} strokeWidth={2} aria-hidden="true" /> 移除
              </button>
            )}
          </div>

          {/* 头像（从手机上传） */}
          <div className="flex items-center gap-4 px-4 py-4">
            <div
              className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full"
              style={{ border: `1px solid ${t.border}` }}
            >
              {previewAvatar ? (
                <img src={previewAvatar} alt="头像预览" className="h-full w-full object-cover" />
              ) : (
                <img src="/default-profile.png" alt="默认头像" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="flex h-[32px] items-center gap-1.5 rounded-full px-4 text-[13px] font-bold transition-opacity active:opacity-70"
                style={{ background: 'rgba(29,155,240,0.12)', color: t.blue }}
              >
                <ImagePlus width={14} height={14} strokeWidth={2.2} aria-hidden="true" /> 从手机上传头像
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar(undefined)}
                  className="flex h-[28px] items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-opacity active:opacity-60"
                  style={{ color: t.secondary }}
                >
                  <Trash2 width={12} height={12} strokeWidth={2.2} aria-hidden="true" /> 移除自定义头像
                </button>
              )}
            </div>
          </div>

          {/* 名字 / 简介（小号未填恢复自己的随机默认；大号未填跟随全局） */}
          <Field
            label="名字"
            value={name}
            onChange={setName}
            placeholder={namePlaceholder}
            maxLength={24}
            ariaLabel={isAnon ? '匿名账号名字' : '自定义名字'}
          />
          <Field
            label="账号"
            value={handle}
            onChange={onHandleChange}
            placeholder={`默认 @${handleFallback}，可自定义`}
            maxLength={20}
            ariaLabel={isAnon ? '匿名账号账号' : '自定义账号'}
          />
          <p className="px-4 pt-1.5 text-[12px]" style={{ color: t.secondary }}>
            {isAnon
              ? `匿名账号的账号是它在论坛的唯一标识，默认 @${handleFallback}，仅限字母、数字、下划线或中文——和大号完全独立，互不可见关联。`
              : `账号是你在X论坛的唯一标识，默认 @${handleFallback}，仅限字母、数字、下划线或中文，不能包含 @ 或空格。`}
          </p>
          <Field
            label="简介"
            value={bio}
            onChange={setBio}
            placeholder={isAnon ? '匿名账号的简介' : 'X论坛用户'}
            maxLength={60}
            ariaLabel={isAnon ? '匿名账号简介' : '自定义简介'}
          />

          <p className="px-4 pt-4 text-[12px] leading-relaxed" style={{ color: t.secondary }}>
            {isAnon
              ? '匿名账号（小号）与大号（主账号）的发帖、评论、点赞完全隔离；AI 看到的一直是一个陌生网友，除非你在私聊里亲口说破。'
              : '留空或移除的项目会跟随全局资料（设置 › 个人信息）；在这里保存过的项目，X论坛会一直使用这里的值。'}
          </p>

          {hasCustom && (
            <button
              type="button"
              onClick={resetAll}
              className="mx-4 mt-4 flex h-[38px] w-[calc(100%-32px)] items-center justify-center gap-2 rounded-full border text-[14px] font-bold transition-opacity active:opacity-60"
              style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
            >
              <RotateCcw width={14} height={14} strokeWidth={2.2} aria-hidden="true" />{' '}
              {isAnon ? '全部恢复默认身份' : '全部恢复跟随全局'}
            </button>
          )}
        </div>

        {/* 隐藏文件选择器（手机相册/拍照） */}
        <input
          ref={avatarRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onAvatarFile(e.target.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={bannerRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onBannerFile(e.target.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}
