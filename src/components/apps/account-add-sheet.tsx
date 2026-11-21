'use client';

/**
 * 添加账号弹层（微信切换账号页 / QQ 切换账号卡片共用）：
 * - 第一步选档位：「大号」= 完整身份主账号（切换列表带「大号」标记）；「小号」= 日常小马甲；
 * - 第二步填资料：名字（必填，即这个身份的称呼）+ 昵称（选填，只用于 QQ/微信/美团/淘宝的显示名，AI 永远不知道）；
 * - 确认后创建注册表账号（自动生成手机号/微信号/QQ号）+ 档案联系人（altOf 关联），回调 onCreated
 *   由宿主完成登录（微信走 handleLogin 链路；QQ 写会话 + 登录历史 + 切账号）。
 * 弹层本身不切账号、不写登录态——登录动作统一由调用方处理。
 */

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { createAccount, updateAccount, type PhoneAccount } from '@/lib/ios/accounts';
import { createContact } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';

export type AccountGrade = 'main' | 'alt';

const GRADES: { key: AccountGrade; title: string; desc: string }[] = [
  { key: 'main', title: '大号', desc: '完整身份的主账号，切换列表带「大号」标记' },
  { key: 'alt', title: '小号', desc: '日常使用的副号小马甲' },
];

export function AccountAddSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** 创建成功（注册表账号 + 档案联系人已落库、号码已回写注册表）；登录/切换由宿主执行 */
  onCreated: (acc: PhoneAccount, contact: ContactRecord) => void;
}) {
  /** null = 还在选档位；选完进资料表单 */
  const [grade, setGrade] = useState<AccountGrade | null>(null);
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError('请填写名字');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // ① 注册表账号：自动生成虚拟手机号/微信号/QQ号；grade 决定「大号/小号」标记
      const acc = createAccount('alt', n, { grade: grade ?? 'alt' });
      // ② 档案联系人（kind='user' + altOf 关联账号；号码留空由 createContact 自动生成后回写注册表）
      const rec = await createContact({
        kind: 'user',
        name: n,
        nickname: nick.trim() || null,
        altOf: acc.id,
      });
      updateAccount(acc.id, {
        ownerContactId: rec.id,
        phone: rec.phone ?? '',
        qqId: rec.qqId ?? '',
        wechatId: rec.wechatId ?? '',
      });
      onCreated(acc, rec);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '创建失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-label="添加账号"
        data-testid="account-add-sheet"
        className="w-full max-w-[340px] rounded-[16px] bg-white p-4 shadow-2xl dark:bg-[#1E1E1E]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[16px] font-medium text-black dark:text-white">{grade === null ? '添加账号' : grade === 'main' ? '添加大号' : '添加小号'}</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid="account-add-close"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-black/40 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2.2} />
          </button>
        </div>

        {grade === null ? (
          <>
            <div className="mt-3 space-y-2">
              {GRADES.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  data-testid={`account-add-grade-${g.key}`}
                  onClick={() => setGrade(g.key)}
                  className="flex w-full flex-col items-start rounded-[12px] bg-black/[0.035] px-4 py-3 text-left active:bg-black/[0.07] dark:bg-white/[0.07] dark:active:bg-white/[0.12]"
                >
                  <span className="text-[15px] font-medium text-black dark:text-white">{g.title}</span>
                  <span className="mt-0.5 text-[12px] leading-[1.5] text-black/45 dark:text-white/45">{g.desc}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11.5px] leading-[1.6] text-black/35 dark:text-white/35">
              创建后自动登录并出现在切换账号列表
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="text-[12.5px] text-black/55 dark:text-white/55">名字</span>
                <input
                  data-testid="account-add-name"
                  value={name}
                  autoFocus
                  maxLength={20}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="这个身份的称呼（必填）"
                  className="mt-1 h-10 w-full rounded-[10px] bg-black/[0.04] px-3 text-[14.5px] text-black outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/15 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30 dark:focus:ring-white/20"
                />
              </label>
              <label className="block">
                <span className="text-[12.5px] text-black/55 dark:text-white/55">昵称（选填）</span>
                <input
                  data-testid="account-add-nickname"
                  value={nick}
                  maxLength={20}
                  onChange={(e) => setNick(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit();
                  }}
                  placeholder="QQ / 微信里显示的名字（AI 不可见）"
                  className="mt-1 h-10 w-full rounded-[10px] bg-black/[0.04] px-3 text-[14.5px] text-black outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/15 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30 dark:focus:ring-white/20"
                />
              </label>
            </div>
            {error && (
              <p data-testid="account-add-error" className="mt-2 text-[12.5px] text-[#FA5151]">
                {error}
              </p>
            )}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                data-testid="account-add-cancel"
                onClick={() => {
                  setError('');
                  setGrade(null);
                }}
                className="h-10 flex-1 rounded-[10px] bg-black/[0.05] text-[14px] text-black active:opacity-80 dark:bg-white/10 dark:text-white"
              >
                上一步
              </button>
              <button
                type="button"
                data-testid="account-add-submit"
                onClick={() => void submit()}
                disabled={busy}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                创建并登录
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
