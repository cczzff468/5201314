'use client';

// 形象锁定（锁脸）区 FaceLockSection（图像生成页页尾复用）+ 锁屏密码页 LockPage。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Lock,
  PenLine,
  ScanFace,
} from 'lucide-react';

import PasscodePad from '@/components/ios/PasscodePad';

import { useSettings } from '@/lib/ios/store';

import { Textarea } from '@/components/ui/textarea';

import { Switch } from '@/components/ui/switch';

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

import {
  compressImageSrc,
  getAppearanceNote,
  getFaceRef,
  setAppearanceNote,
  setFaceRef,
  type ImgGenFaceRef,
} from '@/lib/imggen';

import { listContacts } from '@/lib/ios/contacts-store';

import {
  displayNameOf,
  type ContactRecord,
} from '@/lib/contacts';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  IOS_RED,
  GroupCard,
  TONE_PURPLE,
  DetailShell,
  SectionLabel,
  GrayCard,
} from './shared';


// ---------------- 形象锁定（锁脸）区（图像生成页下方） ----------------

/**
 * 形象锁定（锁脸）区（原微信 / QQ / 信息三端聊天设置里的形象锁定页迁移至此，数据完全兼容）：
 * - 角色选择：横向滚动头像胶囊（绿点徽标 = 已设参考图），数据来自 listContacts()（排除机主）；
 * - 选中角色：参考图上传/替换/删除（compressImageSrc 压到 512px）+ 外貌描述兜底文案（onBlur 即时保存）；
 * - 存储沿用 @/lib/imggen 按 contactId 隔离的 kv（imggen-ref:* / imggen-appearance:*），
 *   与三端聊天里的自动 / 手动生图共用同一份数据，互不覆盖。
 */
export function FaceLockSection() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selId, setSelId] = useState('');
  const [refImg, setRefImg] = useState<ImgGenFaceRef | null>(null);
  const [appearDraft, setAppearDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [refVersion, setRefVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useLocalToast();

  // 联系人列表（IndexedDB 异步；排除机主 kind='user'），默认选中第一个
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listContacts();
        if (cancelled) return;
        const chars = list.filter((c) => c.kind !== 'user');
        setContacts(chars);
        setSelId((prev) => (prev && chars.some((c) => c.id === prev) ? prev : chars[0]?.id ?? ''));
      } catch {
        // IndexedDB 不可用时保持空列表
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换角色：渲染期同步重读该角色的参考图与外貌描述（React 官方 "adjust state on prop change" 模式，kv 同步读）
  const [loadedFor, setLoadedFor] = useState('');
  if (loadedFor !== selId) {
    setLoadedFor(selId);
    setRefImg(selId ? getFaceRef(selId) : null);
    setAppearDraft(selId ? getAppearanceNote(selId) : '');
  }

  /** chip 徽标读取：依赖 refVersion，上传/删除参考图后回调换新 → 徽标即时刷新 */
  const hasRefOf = useCallback((id: string) => Boolean(getFaceRef(id)), [refVersion]);

  /** 选图 → FileReader 读 dataURL → 压缩 512px → 存参考图 → 刷新预览/徽标 + toast */
  const onPickFile = (file: File | undefined) => {
    if (!file || uploading || !selId) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    setUploading(true);
    const fr = new FileReader();
    fr.onload = () => {
      const raw = typeof fr.result === 'string' ? fr.result : '';
      if (!raw.startsWith('data:image/')) {
        setUploading(false);
        showToast('图片读取失败，请换一张试试');
        return;
      }
      void compressImageSrc(raw, 512).then((src) => {
        setFaceRef(selId, src);
        setRefImg(getFaceRef(selId));
        setRefVersion((v) => v + 1);
        setUploading(false);
        showToast('已更新参考图');
      });
    };
    fr.onerror = () => {
      setUploading(false);
      showToast('图片读取失败，请换一张试试');
    };
    fr.readAsDataURL(file);
  };

  /** 删除参考图（外貌描述保留继续兜底） */
  const onDeleteRef = () => {
    if (!selId) return;
    setFaceRef(selId, null);
    setRefImg(null);
    setRefVersion((v) => v + 1);
    showToast('已删除参考图');
  };

  const sel = contacts.find((c) => c.id === selId) ?? null;
  const selLabel = sel ? displayNameOf(sel) : '';

  return (
    <section data-testid="imggen-face-section">
      <SectionLabel icon={ScanFace} tone={TONE_PURPLE}>形象锁定（锁脸）</SectionLabel>

      {/* 角色选择（横向滚动头像胶囊；绿点 = 已设参考图） */}
      {contacts.length === 0 ? (
        <GrayCard>
          <div className="flex flex-col items-center gap-2.5 py-5 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/[0.04]">
              <ScanFace className="h-5 w-5 text-zinc-500" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="text-[13px] leading-relaxed text-zinc-500">
              还没有角色：先到联系人 App 添加角色，再回来为 TA 设置参考图。
            </p>
          </div>
        </GrayCard>
      ) : (
        <>
          <div className="no-scrollbar flex flex-wrap gap-3.5 py-0.5" role="listbox" aria-label="选择角色">
            {contacts.map((c) => {
              const active = c.id === selId;
              const hasRef = hasRefOf(c.id);
              const label = displayNameOf(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`imggen-face-chip-${c.id}`}
                  onClick={() => setSelId(c.id)}
                  className="flex w-[60px] flex-col items-center gap-1.5 rounded-[14px] py-1 transition-all active:scale-95"
                >
                  <span className="relative">
                    {c.avatar ? (
                      <img
                        src={c.avatar}
                        alt={label}
                        draggable={false}
                        className={`h-12 w-12 rounded-full object-cover transition-all ${
                          active ? 'ring-2 ring-zinc-900/60' : 'opacity-75'
                        }`}
                      />
                    ) : (
                      <span
                        className={`grid h-12 w-12 place-items-center rounded-full bg-black/[0.05] text-[15px] font-medium text-zinc-500 transition-all ${
                          active ? 'ring-2 ring-zinc-900/60' : 'opacity-75'
                        }`}
                      >
                        {label.slice(0, 1)}
                      </span>
                    )}
                    {hasRef && (
                      <span
                        aria-label="已设置参考图"
                        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#F3F6F3] bg-[#34C759]"
                      />
                    )}
                  </span>
                  <span
                    className={`w-full truncate px-1 text-center text-[11px] leading-none ${
                      active ? 'font-medium text-zinc-900' : 'text-zinc-900/60'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 选中角色：参考图 + 外貌描述 */}
          {sel && (
            <GrayCard className="mt-3">
              {/* 角色头部：名字 + 三态锁脸状态徽标（已锁脸 / 仅外貌描述 / 未设置） */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {sel.avatar ? (
                    <img
                      src={sel.avatar}
                      alt={selLabel}
                      draggable={false}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-black/[0.06]"
                    />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.05] text-[14px] font-medium text-zinc-500">
                      {selLabel.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[15.5px] font-semibold text-zinc-900">{selLabel}</div>
                    <div className="mt-0.5 text-[11.5px] text-zinc-500">按角色独立保存</div>
                  </div>
                </div>
                {refImg ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#34C759]/[0.12] px-2.5 py-1 text-[11px] font-medium text-[#1E9E4A]">
                    <ScanFace className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                    已锁脸
                  </span>
                ) : appearDraft.trim() ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#FF9500]/[0.14] px-2.5 py-1 text-[11px] font-medium text-[#B26A00]">
                    <PenLine className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                    仅外貌描述
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" aria-hidden="true" />
                    未设置
                  </span>
                )}
              </div>

              {/* 参考图预览（干净细描边装裱；空态虚线占位） */}
              <div className="mx-auto mt-4 w-full max-w-[210px]">
                {refImg ? (
                  <div className="overflow-hidden rounded-[18px] shadow-sm ring-1 ring-black/[0.06]">
                    <img
                      data-testid="imggen-face-ref-img"
                      src={refImg.src}
                      alt={`${selLabel}的生图参考图`}
                      draggable={false}
                      className="aspect-square w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    aria-hidden="true"
                    className="grid aspect-square w-full place-items-center rounded-[18px] border border-dashed border-black/10 bg-black/[0.02] px-5"
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <ScanFace className="h-8 w-8 text-black/25" strokeWidth={1.5} />
                      <span className="text-[11.5px] leading-relaxed text-zinc-500/80">
                        上传一张正脸照
                        <br />
                        生图时锁定 TA 的长相
                      </span>
                    </div>
                  </div>
                )}
                <p className="pt-2.5 text-center text-[11.5px] leading-[1.6] text-zinc-500">
                  参考图会作为生图输入，保证 TA 每次照片里的脸一致
                </p>
              </div>

              {/* 上传 / 替换 / 删除（浅灰按钮，删除红字示警） */}
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  data-testid="imggen-face-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-white/60 py-2.5 text-[14px] font-medium text-zinc-900 shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-black/[0.05] backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="h-[16px] w-[16px] animate-spin" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
                  )}
                  {uploading ? '正在处理…' : refImg ? '替换参考图' : '上传参考图'}
                </button>
                {refImg && (
                  <button
                    type="button"
                    data-testid="imggen-face-delete"
                    onClick={onDeleteRef}
                    className="flex-1 rounded-[14px] bg-white/60 py-2.5 text-[14px] font-medium text-[#FF3B30] shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-black/[0.05] backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-[#FF453A]/10"
                  >
                    删除参考图
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                data-testid="imggen-face-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  onPickFile(f);
                }}
              />

              {/* 外貌描述（onBlur 即时保存；带字数计数） */}
              <div className="mt-4 border-t border-black/[0.05] pt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[13px] font-medium text-zinc-500">
                    外貌描述（锁脸兜底）
                  </div>
                  <span className="text-[11px] tabular-nums text-zinc-500/60">{appearDraft.length}/300</span>
                </div>
                <Textarea
                  data-testid="imggen-face-appear"
                  value={appearDraft}
                  onChange={(e) => setAppearDraft(e.target.value)}
                  onBlur={() => {
                    if (selId) setAppearanceNote(selId, appearDraft);
                  }}
                  placeholder="20岁女生，黑色长直发，杏眼，皮肤白皙，身材苗条"
                  rows={3}
                  maxLength={300}
                  aria-label="外貌描述"
                  className="min-h-[64px] rounded-[14px] border-black/[0.06] bg-white py-2.5 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl"
                />
                <p className="pt-2 text-[12px] leading-[1.6] text-zinc-500/80">
                  未上传参考图或生图模型不支持参考图时，会把这段外貌描述拼进提示词兜底；每个角色独立设置，互不影响。
                </p>
              </div>
            </GrayCard>
          )}
        </>
      )}
      <LocalToast msg={toast} />
    </section>
  );
}

// ---------------- 锁屏密码 ----------------

export type LockStage = 'menu' | 'verifyOff' | 'verifyChange' | 'setNew' | 'confirmNew';

export const LOCK_STAGE_TITLE: Record<Exclude<LockStage, 'menu'>, string> = {
  verifyOff: '输入密码',
  verifyChange: '输入密码',
  setNew: '输入新密码',
  confirmNew: '再输入一次',
};

/**
 * 锁屏密码管理：开启/关闭（需验证原密码）、修改密码（原密码 → 新密码两次）、
 * 密码类型（4/6 位，未开启时可切换）、立即锁定。
 */
export function LockPage({ onBack }: { onBack: () => void }) {
  const lockConfig = useSettings((s) => s.lockConfig);
  const applyLockConfig = useSettings((s) => s.applyLockConfig);
  const setLockScreen = useSettings((s) => s.setLockScreen);

  const [stage, setStage] = useState<LockStage>('menu');
  const [tempCode, setTempCode] = useState('');
  const [errText, setErrText] = useState('');
  const [errSignal, setErrSignal] = useState(0);
  // #63：关锁屏总开关前弹确认框（仅在 enabled && code 已设时，避免误关丢失已设密码）
  const [confirmLockOff, setConfirmLockOff] = useState(false);

  const fail = (msg: string) => {
    setErrSignal((s) => s + 1);
    setErrText(msg);
  };

  const cancelSub = () => {
    setStage('menu');
    setTempCode('');
    setErrText('');
  };

  // ---------------- 菜单 ----------------
  if (stage === 'menu') {
    return (
      <DetailShell title="锁屏与密码" onBack={onBack} gray>
        <GroupCard>
          <div className="divide-y divide-black/[0.05]">
            {/* 锁屏总开关：关掉后不再出现锁屏界面 */}
            <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 text-[16px]">锁屏</span>
              <Switch
                checked={lockConfig.lockScreen}
                onCheckedChange={(v) => {
                  setErrText('');
                  // #63：关锁屏总开关时若已设密码（enabled && code），先弹确认框——
                  // store.setLockScreen(false) 会静默清空 enabled/code，误关会丢失已设密码。
                  // 仅打开或未设密码时直接走原逻辑。
                  if (!v && lockConfig.enabled && lockConfig.code) {
                    setConfirmLockOff(true);
                    return;
                  }
                  setLockScreen(v);
                }}
                aria-label="锁屏开关"
              />
            </div>
            {/* 锁屏密码开关（仅在锁屏开启时可用） */}
            <div
              className={`flex min-h-[52px] items-center gap-3 px-4 py-2 ${
                lockConfig.lockScreen ? '' : 'pointer-events-none opacity-40'
              }`}
            >
              <span className="min-w-0 flex-1 text-[16px]">锁屏密码</span>
              <Switch
                checked={lockConfig.enabled}
                onCheckedChange={(v) => {
                  setErrText('');
                  if (v) {
                    setTempCode('');
                    setStage('setNew');
                  } else if (lockConfig.code) {
                    setStage('verifyOff');
                  } else {
                    applyLockConfig({ lockScreen: true, enabled: false, code: '', len: lockConfig.len });
                  }
                }}
                aria-label="锁屏密码开关"
              />
            </div>
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-zinc-500">
          {lockConfig.lockScreen
            ? '开启后，锁屏上滑解锁需要输入密码；关闭浏览器再打开或按下电源键都会回到锁屏。'
            : '锁屏已关闭：开机和按下电源键都会直接进入主屏幕。'}
        </p>

        {lockConfig.lockScreen && (
          <div className="mt-4">
            <GroupCard>
              {lockConfig.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setErrText('');
                    setTempCode('');
                    setStage('verifyChange');
                  }}
                  className="flex h-[46px] w-full items-center justify-between px-4 text-left transition-colors active:bg-black/[0.05]"
                >
                  <span className="text-[16px]">更改密码</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-zinc-500/60" />
                </button>
              )}
              <div className="flex min-h-[52px] items-center justify-between px-4 py-2">
                <span className="text-[16px]">密码类型</span>
                {lockConfig.enabled ? (
                  <span className="text-[15px] text-zinc-500">
                    {lockConfig.len === 6 ? '6 位数字' : '4 位数字'}
                  </span>
                ) : (
                  <div className="flex rounded-full bg-white/50 p-0.5 ring-1 ring-black/[0.05] backdrop-blur-xl" role="radiogroup" aria-label="密码位数">
                    {([4, 6] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={lockConfig.len === n}
                        onClick={() => applyLockConfig({ lockScreen: true, enabled: false, code: '', len: n })}
                        className={`h-8 w-[68px] rounded-full text-[14px] transition ${
                          lockConfig.len === n
                            ? 'bg-white/95 font-medium text-zinc-900 shadow-sm'
                            : 'text-zinc-500'
                        }`}
                      >
                        {n} 位
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </GroupCard>
          </div>
        )}

        {errText && (
          <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }} role="alert">
            {errText}
          </p>
        )}

        {/* #63：关闭锁屏总开关前确认（仿 themes.tsx「恢复全部默认图标」对话框） */}
        <AlertDialog open={confirmLockOff} onOpenChange={setConfirmLockOff}>
          <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] border-black/[0.06] bg-white! p-0 text-zinc-900! sm:w-[270px] sm:max-w-[270px]">
            <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
              <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug text-zinc-900">
                关闭锁屏？
              </AlertDialogTitle>
              <AlertDialogDescription className="text-center text-[13px] leading-snug text-zinc-500!">
                已设置的锁屏密码将被清除，下次开启锁屏后需重新设置密码。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row gap-0 border-t border-black/[0.06] sm:flex-row">
              <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-zinc-900 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.06] sm:mt-0">
                取消
              </AlertDialogCancel>
              <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-black/[0.06]" />
              <AlertDialogAction
                className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.06] sm:mt-0"
                style={{ color: IOS_RED }}
                onClick={() => {
                  try {
                    navigator.vibrate?.(10);
                  } catch {
                    /* 震动不可用 */
                  }
                  setLockScreen(false);
                  setConfirmLockOff(false);
                }}
              >
                关闭锁屏
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DetailShell>
    );
  }

  // ---------------- 密码输入子页 ----------------

  const handleComplete = (code: string) => {
    if (stage === 'verifyOff') {
      if (code === lockConfig.code) {
        applyLockConfig({ ...lockConfig, enabled: false, code: '' });
        setErrText('');
        setStage('menu');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'verifyChange') {
      if (code === lockConfig.code) {
        setErrText('');
        setTempCode('');
        setStage('setNew');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'setNew') {
      setTempCode(code);
      setErrText('');
      setStage('confirmNew');
    } else if (stage === 'confirmNew') {
      if (code === tempCode) {
        applyLockConfig({ ...lockConfig, enabled: true, code });
        setErrText('');
        setTempCode('');
        setStage('menu');
      } else {
        setTempCode('');
        setStage('setNew');
        fail('两次输入不一致，请重新设置');
      }
    }
  };

  return (
    <DetailShell title="锁屏与密码" onBack={cancelSub} gray>
      <div className="flex flex-col items-center pt-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-black/[0.05] backdrop-blur-xl">
          <Lock className="h-6 w-6 text-zinc-500" strokeWidth={2} />
        </div>
        <p className="mt-3 text-[17px] font-semibold">{LOCK_STAGE_TITLE[stage]}</p>
        {stage === 'confirmNew' && (
          <p className="mt-1 text-[13px] text-zinc-500">请再次输入相同的密码</p>
        )}
        <PasscodePad
          length={lockConfig.len}
          onComplete={handleComplete}
          errorSignal={errSignal}
          className="mt-6"
        />
        <p className="mt-4 min-h-[20px] text-[13px] font-medium" style={{ color: IOS_RED }} role="alert">
          {errText}
        </p>
        <button
          type="button"
          onClick={cancelSub}
          className="mt-2 rounded-full bg-white/60 px-6 py-2 text-[15px] text-zinc-500 shadow-sm ring-1 ring-black/[0.05] backdrop-blur-xl transition-all active:scale-[0.96]"
        >
          取消
        </button>
      </div>
    </DetailShell>
  );
}
