'use client';

/** 登录页 —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, CircleUser, Loader2, Plus, Smartphone, User } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { type PhoneAccount } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { loginAltSlot, loginQQ, listContactsFor } from '@/lib/ios/contacts-store';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';

import { QQUser, QQ_BLUE } from './core';
import { QqToast } from './widgets';

// ---------------- 登录页 ----------------

export function LoginScreen({ onLogin, slot, onBack }: { onLogin: (u: QQUser) => void; slot?: PhoneAccount | null; /** 提供时（账号与安全页「登录小号」入口）：左上角变返回而非退出 QQ */ onBack?: () => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode account：账号密码登录（QQ号/QID/邮箱 + QQ密码）；phone：手机号登录（+86 + QQ密码）
  const [mode, setMode] = useState<'account' | 'phone'>('account');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  // 小号/匿名号槽位（Task 40 修正）：登录墙绑定当前槽位——预填该账号档案的登录账号（用户只需输密码），
  // 避免在 A 小号的登录墙里误登 B 的账号密码导致登录态串槽（切号页显示错账号/再切回要求重登）
  const [slotIdShown, setSlotIdShown] = useState('');
  // 槽位显示名（Task 40-S）：与登录后 QQ 内的名字同口径（档案展示名，昵称优先）
  const [slotNameShown, setSlotNameShown] = useState('');
  useEffect(() => {
    if (!slot) return;
    let alive = true;
    void (async () => {
      const all = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
      if (!alive) return;
      const profile = all.find(
        (c) => c.kind === 'user' && (c.altOf === slot.id || c.id === slot.ownerContactId),
      );
      if (profile && socialNameOf(profile).trim()) setSlotNameShown(socialNameOf(profile).trim());
      const id = profile?.qqId?.trim() || profile?.phone?.trim() || profile?.wechatId?.trim() || '';
      if (alive && id) {
        setSlotIdShown(id);
        setAccount((a) => (a.trim() ? a : id));
      }
    })();
    return () => {
      alive = false;
    };
  }, [slot]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const canSubmit = account.trim().length > 0 && password.length > 0 && agreed && !busy;

  const submit = async () => {
    if (!agreed) {
      setError('请先勾选同意服务协议和隐私政策');
      return;
    }
    if (account.trim().length === 0 || password.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      // 小号/匿名号槽位：绑定登录——只认本槽位档案的账号密码（Task 40 修正）
      if (slot) {
        const alt = await loginAltSlot('qq', slot, account.trim(), password);
        if (alt.ok) {
          onLogin({
            id: alt.user.id,
            name: alt.user.name,
            realName: alt.user.realName,
            nickname: alt.user.nickname,
            avatar: alt.user.avatar,
            qqId: alt.user.qqId,
            phone: alt.user.phone,
            persona: alt.user.persona,
            // Task 41：altOf 必须透传——根组件据此切账号作用域 + 记登录历史
            altOf: alt.user.altOf,
          });
          return;
        }
        setError(alt.error);
        return;
      }
      const rec = await loginQQ(mode === 'phone' ? 'phone' : 'account', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          realName: rec.user.realName,
          nickname: rec.user.nickname,
          avatar: rec.user.avatar,
          qqId: rec.user.qqId,
          phone: rec.user.phone,
          persona: rec.user.persona,
          // Task 41：自由登录命中小号档案时 altOf 非空——根组件据此切作用域（缺失会串槽）
          altOf: rec.user.altOf,
        });
        return;
      }
      setError(rec.error);
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const bottomEntries =
    mode === 'account'
      ? [
          { key: 'phone', label: '手机号登录', icon: <Smartphone className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('phone') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ]
      : [
          { key: 'account', label: '账密登录', icon: <CircleUser className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('account') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ];

  return (
    <div className="relative flex h-full w-full flex-col bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] pt-[54px] text-[#1F2329] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38] dark:text-white">
      {/* 顶部：关闭/返回 + 帮助（内嵌登录小号时为返回） */}
      <div className="flex h-11 items-center justify-between px-4">
        <button
          type="button"
          aria-label={onBack ? '返回' : '关闭QQ'}
          data-testid={onBack ? 'qq-login-back' : 'qq-login-close'}
          onClick={() => (onBack ? onBack() : closeApp())}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="text-[16px] text-black/70 active:opacity-60 dark:text-white/70"
          onClick={() => showToast('帮助暂未开放')}
        >
          帮助
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <h1 className="mt-12 text-center text-[30px] font-bold tracking-wide">
          {mode === 'account' ? '账号密码登录' : '手机号登录'}
        </h1>

        {/* 小号/匿名号槽位：明示当前登录身份 + 档案账号（Task 40 修正）；退出后的自由登录墙无槽位不显示（Task 41） */}
        {slot && (
          <p data-testid="qq-login-slot" className="mt-2.5 text-center text-[13.5px] leading-relaxed text-black/45 dark:text-white/45">
            当前账号：{slotNameShown || slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号')}
            {slotIdShown ? `（${slotIdShown}）` : ''}
          </p>
        )}
        {mode === 'phone' && (
          <p className="mt-4 text-center text-[15px] text-black/40 dark:text-white/40">未注册手机号通过验证后将自动注册</p>
        )}

        {/* 输入卡（白色胶囊） */}
        <div className="mt-12 space-y-4">
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            {mode === 'phone' && (
              <span className="mr-3 flex shrink-0 items-center gap-1 text-[20px] font-semibold">
                +86
                <svg viewBox="0 0 12 8" className="h-2.5 w-3.5 text-black/50 dark:text-white/50" aria-hidden="true">
                  <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
            )}
            <input
              data-testid="qq-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'account' ? '输入QQ号/QID/邮箱' : '输入手机号码'}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode={mode === 'phone' ? 'tel' : 'text'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            <input
              data-testid="qq-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'account' ? '输入QQ密码' : '输入QQ密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'account' && (
          <button
            type="button"
            className="mt-5 text-[15px] font-medium text-[#1E6FFF] active:opacity-60"
            onClick={() => showToast('密码找回暂未开放，请到「联系人」App 查看账号密码')}
          >
            找回密码
          </button>
        )}

        {error && (
          <p data-testid="qq-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="qq-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mt-8 block h-[52px] w-full rounded-full text-[18px] font-medium text-white transition-colors ${
            canSubmit ? 'active:brightness-95' : 'opacity-45'
          }`}
          style={{ backgroundColor: canSubmit ? QQ_BLUE : '#7FCDF8' }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              正在登录…
            </span>
          ) : mode === 'account' ? (
            '登 录'
          ) : (
            '验证并登录'
          )}
        </button>

        {/* 协议勾选 */}
        <button
          type="button"
          data-testid="qq-login-agree"
          aria-pressed={agreed}
          onClick={() => {
            setAgreed((v) => !v);
            setError('');
          }}
          className="mx-auto mt-5 flex max-w-[300px] items-start gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${
              agreed ? 'border-transparent' : 'border-black/25 dark:border-white/35'
            }`}
            style={agreed ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {agreed && (
              <svg viewBox="0 0 12 10" className="h-2.5 w-3 text-white" aria-hidden="true">
                <path d="M1 5.2 4.2 8.4 11 1.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="text-[13px] leading-[18px] text-black/45 dark:text-white/45">
            已阅读并同意<span className="text-[#1E6FFF]">服务协议</span>和
            <span className="text-[#1E6FFF]">隐私政策</span>
            {mode === 'phone' ? '及' : ''}
            {mode === 'phone' && <span className="text-[#1E6FFF]">运营商服务条款</span>}
          </span>
        </button>
      </div>

      {/* 底部三个圆圈入口 */}
      <div className="flex items-start justify-center gap-10 pb-9 pt-4">
        {bottomEntries.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={e.action}
            data-testid={`qq-login-entry-${e.key}`}
            className="flex w-[80px] flex-col items-center gap-2"
          >
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full border border-black/12 text-black/60 dark:border-white/20 dark:text-white/60">
              {e.icon}
            </span>
            <span className="whitespace-nowrap text-[12px] text-black/60 dark:text-white/60">{e.label}</span>
          </button>
        ))}
      </div>

      {toast && <QqToast text={toast} />}
    </div>
  );
}
