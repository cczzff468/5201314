'use client';

/** 登录页 —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useState } from 'react';
import { X, ChevronLeft } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { type PhoneAccount } from '@/lib/ios/accounts';
import { loginAltSlot, loginWechat, listContacts } from '@/lib/ios/contacts-store';
import { socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）

import { WxUser } from './core';

// ---------------- 登录页 ----------------

export function LoginScreen({ onLogin, slot, onBack }: { onLogin: (u: WxUser) => void; slot?: PhoneAccount | null; /** 提供时（切换账号页「登录小号」入口）：左上角变返回而非关闭整个微信 */ onBack?: () => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode phone：手机号 + 微信密码；account：微信号 / QQ号 / 邮箱 + 密码（后端自动识别）
  const [mode, setMode] = useState<'phone' | 'account'>('phone');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 小号/匿名号槽位（Task 40 修正）：登录墙绑定当前槽位——预填该账号档案的登录账号（用户只需输密码），
  // 避免在 A 小号的登录墙里误登 B 的账号密码导致登录态串槽（切号页显示错账号/再切回要求重登）
  const [slotIdShown, setSlotIdShown] = useState('');
  // 槽位显示名（Task 40-S）：与登录后微信内的名字同口径（档案展示名，昵称优先）
  const [slotNameShown, setSlotNameShown] = useState('');
  useEffect(() => {
    if (!slot) return;
    let alive = true;
    void (async () => {
      const all = await listContacts().catch(() => [] as ContactRecord[]);
      if (!alive) return;
      const profile = all.find(
        (c) => c.kind === 'user' && (c.altOf === slot.id || c.id === slot.ownerContactId),
      );
      if (profile && socialNameOf(profile).trim()) setSlotNameShown(socialNameOf(profile).trim());
      const id = profile?.phone?.trim() || profile?.wechatId?.trim() || profile?.qqId?.trim() || '';
      if (alive && id) {
        setSlotIdShown(id);
        setAccount((a) => (a.trim() ? a : id));
      }
    })();
    return () => {
      alive = false;
    };
  }, [slot]);

  const canSubmit = account.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      // 小号/匿名号槽位：绑定登录——只认本槽位档案的账号密码（Task 40 修正）
      if (slot) {
        const alt = await loginAltSlot('wx', slot, account.trim(), password);
        if (alt.ok) {
          onLogin({
            id: alt.user.id,
            name: alt.user.name,
            realName: alt.user.realName,
            nickname: alt.user.nickname,
            avatar: alt.user.avatar,
            wechatId: alt.user.wechatId,
            phone: alt.user.phone,
            qqId: alt.user.qqId,
            // Task 41：altOf 必须透传——根组件据此切账号作用域 + 记登录历史
            altOf: alt.user.altOf,
          });
          return;
        }
        setError(alt.error);
        return;
      }
      // 本地校验：联系人存本地 IndexedDB，不再调服务端
      const rec = await loginWechat(mode === 'phone' ? 'phone' : 'wechat', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          realName: rec.user.realName,
          nickname: rec.user.nickname,
          avatar: rec.user.avatar,
          wechatId: rec.user.wechatId,
          phone: rec.user.phone,
          qqId: rec.user.qqId,
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

  return (
    <div className="flex h-full w-full flex-col bg-[#EDEDED] pt-[54px] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶部关闭/返回（切换账号页内嵌时为返回） */}
      <div className="flex h-11 items-center px-4">
        <button
          type="button"
          aria-label={onBack ? '返回' : '关闭微信'}
          data-testid={onBack ? 'wx-login-back' : 'wx-login-close'}
          onClick={() => (onBack ? onBack() : closeApp())}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          {onBack ? <ChevronLeft className="h-6 w-6" strokeWidth={1.8} /> : <X className="h-6 w-6" strokeWidth={1.8} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7">
        <h1 className="mt-8 text-center text-[26px] font-semibold tracking-wide">
          {mode === 'phone' ? '手机号登录' : '微信账号登录'}
        </h1>

        {/* 小号/匿名号槽位：明示当前登录身份 + 档案账号（Task 40 修正）；退出后的自由登录墙无槽位不显示（Task 41） */}
        {slot && (
          <p data-testid="wx-login-slot" className="mt-2.5 text-center text-[13px] leading-relaxed text-black/45 dark:text-white/45">
            当前账号：{slotNameShown || slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号')}
            {slotIdShown ? `（${slotIdShown}）` : ''}
          </p>
        )}

        <div className="mt-10 space-y-0">
          {mode === 'phone' && (
            <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
              <span className="w-[104px] shrink-0 text-[17px]">国家/地区</span>
              <span className="text-[17px] text-black/45 dark:text-white/45">中国大陆（+86）</span>
            </div>
          )}
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">{mode === 'phone' ? '手机号' : '账号'}</span>
            <input
              data-testid="wx-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'phone' ? '请填写手机号码' : '微信号 / QQ号 / 邮箱'}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">密码</span>
            <input
              data-testid="wx-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'phone' ? '请填写微信密码' : '请填写密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'phone' && (
          <p className="mt-3 text-[13px] text-black/35 dark:text-white/35">上述手机号仅用于登录验证</p>
        )}

        <button
          type="button"
          data-testid="wx-login-switch"
          onClick={() => {
            setMode(mode === 'phone' ? 'account' : 'phone');
            setError('');
          }}
          className="mt-3 text-[15px] font-medium text-[#576B95] active:opacity-60"
        >
          {mode === 'phone' ? '用微信号/QQ号/邮箱登录' : '用手机号登录'}
        </button>

        {error && (
          <p data-testid="wx-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="wx-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mx-auto mt-10 block h-[46px] w-full max-w-[300px] rounded-[8px] text-[17px] font-medium transition-colors ${
            canSubmit
              ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
              : 'bg-black/10 text-black/35 dark:bg-white/10 dark:text-white/35'
          }`}
        >
          {busy ? '正在登录…' : '同意并继续'}
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 pb-8 pt-4 text-[15px] text-[#576B95]">
        <button type="button" className="active:opacity-60" onClick={() => setError('密码找回暂未开放，请到「联系人」App 查看账号密码')}>
          找回密码
        </button>
        <span className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
        <span className="text-black/40 dark:text-white/40">更多</span>
      </div>
    </div>
  );
}
