'use client';

// 个人资料 ProfilePage / 账号管理 AccountSwitchPage / 关于本机 AboutPage。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type { ChangeEvent } from 'react';

import {
  Camera,
  Minus,
  Plus,
  User,
  X,
} from 'lucide-react';

import { useSettings } from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';

import { mainOwnerContact } from '@/lib/ios/contacts-store';

import {
  accountDisplayName,
  accountUsedBy,
  createAccount,
  deleteAccount,
  getAccounts,
  MAIN_ACCOUNT_ID,
  type AccountApp,
  type PhoneAccount,
} from '@/lib/ios/accounts';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  IOS_RED,
  GroupCard,
  DetailShell,
  useOwnerAvatar,
} from './shared';


// ---------------- 关于本机 ----------------

export function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
      <span className="shrink-0 text-[16px]">{label}</span>
      <span className="text-right text-[15px] text-zinc-500">{value}</span>
    </div>
  );
}

// ---------------- 个人信息 ----------------

/** 个人信息页：从手机上传头像（设置侧独立头像，不写入微信/QQ/联系人全局）、修改名字与标签（即改即存） */
export function ProfilePage({ onBack }: { onBack: () => void }) {
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  const ownerAvatar = useOwnerAvatar();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一张图
    if (!file) return;
    void fileToAvatarDataUrl(file)
      .then((dataUrl) => setProfile({ avatar: dataUrl }))
      .catch(() => undefined);
  };

  return (
    <DetailShell title="个人信息" onBack={onBack} gray>
      {/* 头像：点击从手机相册/文件选择 */}
      <div className="flex flex-col items-center pt-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          className="relative rounded-full transition-transform active:scale-95"
        >
          {(profile.avatar || ownerAvatar) ? (
            <img
              src={profile.avatar || ownerAvatar || ''}
              alt="头像"
              className="h-[88px] w-[88px] rounded-full object-cover"
            />
          ) : (
            <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8]">
              <User className="h-11 w-11 text-[#7C7C84]" strokeWidth={1.8} />
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-[#F2F2F7] bg-white/85 shadow-sm backdrop-blur-xl">
            <Camera className="h-[15px] w-[15px] text-zinc-900" strokeWidth={2.2} />
          </span>
        </button>
        <p className="mt-2.5 text-[12px] text-zinc-500">轻点头像，从手机相册选择照片（未设置时跟随联系人资料头像）</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      </div>

      {/* 名字 / 标签（即改即存） */}
      <div className="mt-6">
        <GroupCard>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-zinc-500">名字</span>
            <Input
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              placeholder="iPhone 用户"
              maxLength={20}
              aria-label="名字"
              className="h-11 border-0 bg-transparent px-0 text-[16px] text-zinc-900 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-zinc-500">标签</span>
            <Input
              value={profile.tag}
              onChange={(e) => setProfile({ tag: e.target.value })}
              placeholder="Apple 账户、iCloud"
              maxLength={30}
              aria-label="标签"
              className="h-11 border-0 bg-transparent px-0 text-[16px] text-zinc-900 shadow-none focus-visible:ring-0"
            />
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-zinc-500">
          名字将显示在锁屏「×××的iPhone」小组件上；头像、名字与标签自动保存。此头像仅用于设置侧（与微信/QQ 各自独立、互不影响）；微信/QQ 请在各自 App 的个人资料页更换。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- 账号管理 ----------------

/** 账号首字母圆配色：小号=蓝绿系、匿名号=深灰系（SETTINGS-THEME：恒浅色，不随深色变黑） */
export const ACCOUNT_AVATAR_TONE: Record<'alt' | 'anon', string> = {
  alt: 'bg-[#D5F0EC] text-[#0E7C6B]',
  anon: 'bg-[#E4E4E9] text-[#55555C]',
};

/** accountUsedBy 的 App 中文名映射（「使用中：微信·QQ」副行用） */
export const ACCOUNT_APP_NAMES: Record<AccountApp, string> = { wx: '微信', qq: 'QQ', sms: '信息', phone: '电话', cabin: '拾光小屋', forum: 'X论坛', reading: '阅读' };

/**
 * 账号管理页（多账号系统 Task 40-C，v2 per-app 账号适配；Task 40-R 流程修正）：
 * - 账号列表：大号 = 机主资料（mainOwnerContact 实时资料），小号/匿名号 = 注册名 + 虚拟号；
 *   副行标注「使用中：微信·QQ」（该账号正被哪些 App 使用，accountUsedBy，空 = 不显示）；
 * - v2 无全局切换：行点击不再切换账号（微信/QQ/信息/电话在各自 App 内切换，互相独立）；
 * - 小号创建入口在联系人 App 「小号」tab（本页不再创建小号）；匿名号无人设档案，
 *   保留受控命名小弹窗（可留空用默认名）→ createAccount('anon')（不自动切换）；
 * - 非大号行右侧常驻 ⊖ 圆钮（iOS 订阅管理风）→ 确认弹窗（写明清除全部数据）→ deleteAccount()（async），
 *   正在使用中的账号删除时自动切回大号（退出该账号），不再拦截。
 */
export function AccountSwitchPage({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => getAccounts());
  // 机主实时资料（大号显示名/号码/头像）：跨账号直读大号库（mainOwnerContact），
  // 避免在小号视角下误用当前库的机主联系人
  const [owner, setOwner] = useState<{ name: string; phone: string; avatar: string | null }>({
    name: '',
    phone: '',
    avatar: null,
  });
  // 命名小弹窗：null=关闭；'anon'=正在创建匿名号码（小号创建入口在联系人 App，不再提供）
  const [namingKind, setNamingKind] = useState<'anon' | null>(null);
  const [namingInput, setNamingInput] = useState('');
  // 待删除账号 id（确认弹窗）
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 删除时是否保留数据（规则：删除账号后数据是否保留由用户决定；默认不保留）
  const [delKeepData, setDelKeepData] = useState(false);
  const [toast, showToast] = useLocalToast();

  // 机主资料异步加载（跨账号读大号库；失败回退「机主」+ 注册表字段）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await mainOwnerContact();
        if (cancelled) return;
        setOwner({
          name: me?.name?.trim() ?? '',
          phone: me?.phone?.trim() ?? '',
          avatar: me?.avatar ?? null,
        });
      } catch {
        // IndexedDB 不可用时保持空资料：显示名回退「机主」，号码回退注册表
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 账号显示名：大号 = 机主联系人名回退「机主」；小号/匿名号 = 注册名 */
  const displayName = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) return owner.name || accountDisplayName(acc);
    return acc.name;
  };

  /** 副行小字：kind 徽标文案 + 号码（大号用实时机主号码，回退注册表号码）+ 使用中的 App（空 = 不显示） */
  const subline = (acc: PhoneAccount): string => {
    const badge = acc.kind === 'main' ? '大号' : acc.kind === 'alt' ? '小号' : '匿名号码';
    const phone = (acc.id === MAIN_ACCOUNT_ID ? owner.phone || acc.phone : acc.phone).trim();
    const base = phone ? `${badge} · ${phone}` : badge;
    const usedBy = accountUsedBy(acc.id)
      .map((a) => ACCOUNT_APP_NAMES[a])
      .join('·');
    return usedBy ? `${base} · 使用中：${usedBy}` : base;
  };

  /** 头像圆：大号 = 机主头像回退首字母中性圆；小号/匿名号 = 首字母彩色圆（蓝绿系/深灰系） */
  const renderAvatar = (acc: PhoneAccount) => {
    const name = displayName(acc);
    const initial = [...name.trim()][0]?.toUpperCase() || '?';
    if (acc.id === MAIN_ACCOUNT_ID) {
      if (owner.avatar) {
        return <img src={owner.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
      }
      return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8] text-[16px] font-medium text-[#7C7C84]">
          {initial}
        </span>
      );
    }
    return (
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[16px] font-medium ${ACCOUNT_AVATAR_TONE[acc.kind]}`}
      >
        {initial}
      </span>
    );
  };

  const deletingAccount = accounts.find((a) => a.id === deletingId) ?? null;

  return (
    <DetailShell title="账号管理" onBack={onBack} gray>
      {/* 账号列表：v2 无全局切换——行不再可点击切换；副行标注该账号正被哪些 App 使用 */}
      <GroupCard>
        {accounts.map((acc) => {
          const name = displayName(acc);
          const deletable = acc.id !== MAIN_ACCOUNT_ID;
          return (
            <div key={acc.id} className="flex min-h-[64px] items-center gap-3 py-1 pl-4 pr-3" data-testid={`settings-account-row-${acc.id}`}>
              {renderAvatar(acc)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] leading-snug">{name}</span>
                <span className="mt-0.5 block truncate text-[12px] text-zinc-500">{subline(acc)}</span>
              </span>
              {deletable && (
                <button
                  type="button"
                  data-testid={`settings-account-delete-${acc.id}`}
                  aria-label={`删除 ${name}`}
                  onClick={() => setDeletingId(acc.id)}
                  className="mr-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[#FF453A]/45 text-[#FF453A] transition-colors active:bg-[#FF453A]/10"
                >
                  <Minus className="h-[14px] w-[14px]" strokeWidth={2.8} />
                </button>
              )}
            </div>
          );
        })}
      </GroupCard>

      {/* 添加匿名号码（小号创建入口在联系人 App 「小号」tab，此处不再提供） */}
      <div className="mt-5">
        <GroupCard>
          <button
            type="button"
            data-testid="settings-account-add-anon"
            onClick={() => {
              setNamingInput('');
              setNamingKind('anon');
            }}
            className="flex h-[50px] w-full items-center gap-3 px-4 text-left text-zinc-900 transition-colors active:bg-black/[0.05]"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#34C759]">
              <Plus className="h-[14px] w-[14px] text-white" strokeWidth={3} />
            </span>
            <span className="flex-1 text-[16px]">新建匿名号码</span>
          </button>
        </GroupCard>
        <p className="mt-3 px-1 text-[12px] leading-relaxed text-zinc-500">
          新建小号：打开联系人 App → 「小号」，创建后可在微信 / QQ / 信息 / 电话的切换账号处登录使用。
          四个 App 切换账号互相独立，切换不刷新页面；在联系人 App 删除小号后，正在使用它的 App 会自动退出该账号。
          其他 App 数据（照片、备忘录等）为整机共享，不随账号变化。
        </p>
      </div>

      {/* 命名小弹窗（匿名号码）：输入可留空（默认名「匿名账号」），创建后不自动切换 */}
      <AlertDialog
        open={namingKind !== null}
        onOpenChange={(open) => {
          if (!open) setNamingKind(null);
        }}
      >
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] border-black/[0.06] bg-white! p-0 text-zinc-900! sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-3 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">新建匿名号码</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug text-zinc-500!">
              给这个身份起个名字，留空则默认「匿名账号」；创建后可在微信 / QQ / 信息 / 电话中切换使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-5 pb-4">
            <Input
              data-testid="settings-account-name-input"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              placeholder="匿名账号"
              maxLength={20}
              aria-label="账号名称"
              className="bg-white text-zinc-900 ring-1 ring-black/[0.06]"
            />
          </div>
          <AlertDialogFooter className="flex-row gap-0 border-t border-black/[0.06] sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-zinc-900 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.05] sm:mt-0">
              取消
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-black/[0.06]" />
            <AlertDialogAction
              data-testid="settings-account-create-confirm"
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium text-[#0A84FF] shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.05] sm:mt-0"
              onClick={() => {
                const kind = namingKind;
                setNamingKind(null);
                if (!kind) return;
                const acc = createAccount(kind, namingInput);
                // v2 不自动切换：在各 App（微信/QQ/信息/电话）内自行切换使用
                setAccounts(getAccounts());
                showToast(`已创建「${accountDisplayName(acc)}」，可在微信 / QQ / 信息 / 电话中切换使用`);
              }}
            >
              创建
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认：写明将清除该账号全部数据；正在使用中的账号删除时自动切回大号（退出该账号） */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] border-black/[0.06] bg-white! p-0 text-zinc-900! sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              删除「{deletingAccount ? displayName(deletingAccount) : ''}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug text-zinc-500!">
              将删除该账号及登录态；正在使用它的微信 / QQ 等会自动退出并回到大号。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label
            data-testid="settings-account-delete-keep"
            className="mx-5 mb-1 flex cursor-pointer items-start gap-2.5 rounded-[8px] bg-black/[0.04] px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={delKeepData}
              onChange={(e) => setDelKeepData(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF3B30]"
            />
            <span className="text-left text-[12.5px] leading-[1.55] text-zinc-500">保留该账号的数据（聊天记录、记忆、朋友圈等；数据不可见也无法恢复登录）</span>
          </label>
          <AlertDialogFooter className="flex-row gap-0 border-t border-black/[0.06] sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-zinc-900 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.05] sm:mt-0">
              取消
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-black/[0.06]" />
            <AlertDialogAction
              data-testid="settings-account-delete-confirm"
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.05] sm:mt-0"
              style={{ color: IOS_RED }}
              onClick={() => {
                const id = deletingId;
                const keep = delKeepData;
                setDeletingId(null);
                setDelKeepData(false);
                if (!id) return;
                void deleteAccount(id, { keepData: keep }).then((result) => {
                  if (result.ok) {
                    setAccounts(getAccounts());
                    showToast(keep ? '已删除该账号（数据已保留）' : '已删除该账号');
                  } else {
                    showToast(result.error ?? '删除失败');
                  }
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toast} />
    </DetailShell>
  );
}

export function AboutPage({ onBack }: { onBack: () => void }) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const uaShort = ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;

  return (
    <DetailShell title="关于本机" onBack={onBack} gray>
      <GroupCard>
        <AboutRow label="名称" value="iPhone" />
        <AboutRow label="系统版本" value="iOS Web 1.0.0" />
        <AboutRow label="架构" value="本地优先（IndexedDB）" />
        <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
          <span className="shrink-0 text-[16px]">浏览器</span>
          <span className="truncate text-right text-[13px] text-zinc-500" title={ua || undefined}>
            {uaShort || '—'}
          </span>
        </div>
      </GroupCard>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-zinc-500">
        照片、备忘录、日程、聊天与全部设置均保存在浏览器 IndexedDB 中，可随时清理，不会上传服务器。
      </p>
    </DetailShell>
  );
}
