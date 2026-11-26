'use client';

/**
 * 账号门禁屏（PhoneShell 第一层门禁，覆盖在壁纸与状态栏之上）：
 *
 * - AuthScreen：登录/注册双模式自选（需求第一节）
 *   · 登录：账号密码（永久有效）｜邮箱验证码（临时 24h）双方式
 *   · 注册：QQ邮箱验证码（管理员人工审核，注册后 pending）｜邀请码（免审核直接 approved）
 * - PendingReviewScreen：待审核强制拦截页（需求第二节）——仅展示「管理员正在审核，请稍后」，
 *   无任何聊天/设置/功能入口；每 30 秒静默轮询会话，审核通过后自动解锁（手动刷新亦可）。
 *
 * 成功登录/注册后 useAuth.setUser 更新 phase，PhoneShell 自动切走本屏——无需路由跳转。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Hourglass, KeyRound, Loader2, LogIn, Mail, MessageCircleHeart, Ticket, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, type AuthUser } from '@/lib/auth/store';

// ---------------- 小组件 ----------------

/** iOS 分段控制器（登录/注册、密码/验证码、邮箱/邀请码） */
function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex w-full rounded-full bg-black/[0.08] p-[3px] dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full py-[7px] text-[13px] font-semibold transition-all duration-200 ${
            value === o.value
              ? 'bg-white text-black shadow-sm dark:bg-[#3a3a3c] dark:text-white'
              : 'text-black/50 dark:text-white/50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS 风格输入框（左图标 + 半透明填充） */
function Field({
  icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-black/35 dark:text-white/40">
        {icon}
      </span>
      <input
        {...props}
        className={`h-12 w-full rounded-2xl border border-black/[0.08] bg-white/70 pl-10 pr-4 text-[16px] text-black placeholder:text-black/35 outline-none transition-colors focus:border-black/30 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/40 ${props.className ?? ''}`}
      />
    </div>
  );
}

/** 主按钮（黑底白字 / 深色白底黑字，iOS 经典） */
function PrimaryButton({
  busy,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; children: ReactNode }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-[16px] font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-40 dark:bg-white dark:text-black"
    >
      {busy && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
      {children}
    </button>
  );
}

/** 发送验证码按钮（右侧内联小胶囊 + 60 秒倒计时） */
function SendCodeButton({ countdown, onClick, busy }: { countdown: number; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={countdown > 0 || busy}
      className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/[0.08] px-3 py-1.5 text-[12px] font-semibold text-black/70 transition-colors active:bg-black/15 disabled:opacity-45 dark:bg-white/15 dark:text-white/80 dark:active:bg-white/25"
    >
      {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
    </button>
  );
}

// ---------------- 登录/注册页 ----------------

type Mode = 'login' | 'register';
type LoginTab = 'password' | 'code';
type RegTab = 'email' | 'invite';

export default function AuthScreen() {
  const setUser = useAuth((s) => s.setUser);
  const [mode, setMode] = useState<Mode>('login');
  const [loginTab, setLoginTab] = useState<LoginTab>('password');
  const [regTab, setRegTab] = useState<RegTab>('invite');

  // 登录
  const [account, setAccount] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  // 注册（邮箱验证码）
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regName, setRegName] = useState('');
  // 注册（邀请码）
  const [inviteCode, setInviteCode] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 60 秒发送倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const applySession = (user: AuthUser) => {
    setUser(user);
    if (user.status === 'pending') {
      toast.success('注册成功，请等待管理员审核');
    } else {
      toast.success(user.name ? `欢迎回来，${user.name}` : '欢迎回来');
    }
  };

  const call = async (url: string, body: Record<string, unknown>): Promise<{ ok: boolean; user?: AuthUser; message?: string }> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
    return { ok: res.ok, user: data.user, message: data.error || '操作失败，请稍后重试' };
  };

  // 发送验证码（注册/登录共用）
  const sendCode = async (purpose: 'register' | 'login') => {
    const email = purpose === 'register' ? regEmail : loginEmail;
    if (!email.trim()) {
      setError('请先输入邮箱');
      return;
    }
    setError('');
    setSending(true);
    try {
      const res = await fetch(`/api/auth/${purpose === 'register' ? 'register' : 'login'}/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.ok) {
        setCountdown(60);
        toast.success(data.message || '验证码已发送，请查收邮件');
      } else {
        setError(data.error || '验证码发送失败');
      }
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  // 登录·账号密码（永久有效）
  const submitLoginPassword = async () => {
    if (!account.trim() || !loginPassword) {
      setError('请输入账号和密码');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await call('/api/auth/login/password', { account: account.trim(), password: loginPassword });
      if (r.ok && r.user) applySession(r.user);
      else setError(r.message || '账号或密码不正确');
    } finally {
      setBusy(false);
    }
  };

  // 登录·邮箱验证码（临时会话）
  const submitLoginCode = async () => {
    if (!loginEmail.trim() || !/^\d{6}$/.test(loginCode.trim())) {
      setError('请输入邮箱和 6 位验证码');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await call('/api/auth/login/verify', { email: loginEmail.trim(), code: loginCode.trim() });
      if (r.ok && r.user) applySession(r.user);
      else setError(r.message || '验证码错误或已过期');
    } finally {
      setBusy(false);
    }
  };

  // 注册·邮箱验证码（人工审核流程）
  const submitRegisterEmail = async () => {
    if (!regEmail.trim() || !/^\d{6}$/.test(regCode.trim())) {
      setError('请输入邮箱和 6 位验证码');
      return;
    }
    if (regPassword.length < 6) {
      setError('密码长度需至少 6 位');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await call('/api/auth/register/verify', {
        email: regEmail.trim(),
        code: regCode.trim(),
        password: regPassword,
        name: regName.trim() || undefined,
      });
      if (r.ok && r.user) applySession(r.user);
      else setError(r.message || '验证码错误或已过期');
    } finally {
      setBusy(false);
    }
  };

  // 注册·邀请码（免审核直接通过）
  const submitRegisterInvite = async () => {
    if (!inviteCode.trim() || !inviteName.trim() || invitePassword.length < 6) {
      setError('请填写邀请码、用户名（2~20位）和至少 6 位密码');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await call('/api/auth/register/invite', {
        inviteCode: inviteCode.trim(),
        name: inviteName.trim(),
        password: invitePassword,
      });
      if (r.ok && r.user) applySession(r.user);
      else setError(r.message || '邀请码无效或已被使用');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto overscroll-none">
      {/* 深色渐变压暗壁纸，保证表单可读性（上浅下深，锁定页质感） */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/45 to-black/55" />

      {/* 品牌 */}
      <div className="relative flex flex-col items-center pb-5 pt-[13%]">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-white/85 shadow-lg backdrop-blur-xl dark:bg-[#2c2c2e]/90">
          <MessageCircleHeart className="h-10 w-10 text-black dark:text-white" strokeWidth={1.8} />
        </div>
        <div className="mt-3 text-[26px] font-bold tracking-tight text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.4)]">
          Cove
        </div>
        <div className="mt-0.5 text-[13px] text-white/70">{mode === 'login' ? '欢迎回来，请登录' : '创建你的专属账号'}</div>
      </div>

      {/* 表单卡片 */}
      <div className="relative mx-auto w-full max-w-[320px] px-6 pb-10">
        <div className="rounded-[28px] border border-white/40 bg-white/75 p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c1e]/75">
          <Segment
            value={mode}
            onChange={(v) => {
              setMode(v);
              setError('');
            }}
            options={[
              { value: 'login', label: '登录' },
              { value: 'register', label: '注册' },
            ]}
          />

          {/* ---------- 登录 ---------- */}
          {mode === 'login' && (
            <div className="mt-4 flex flex-col gap-3">
              <Segment
                value={loginTab}
                onChange={(v) => {
                  setLoginTab(v);
                  setError('');
                }}
                options={[
                  { value: 'password', label: '账号密码' },
                  { value: 'code', label: '邮箱验证码' },
                ]}
              />
              {loginTab === 'password' ? (
                <>
                  <Field
                    icon={<UserPlus className="h-[18px] w-[18px]" />}
                    placeholder="邮箱或用户名"
                    value={account}
                    autoComplete="username"
                    onChange={(e) => setAccount(e.target.value)}
                  />
                  <Field
                    icon={<KeyRound className="h-[18px] w-[18px]" />}
                    placeholder="密码"
                    type="password"
                    value={loginPassword}
                    autoComplete="current-password"
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                  <PrimaryButton busy={busy} onClick={submitLoginPassword}>
                    <LogIn className="h-[18px] w-[18px]" />
                    登录
                  </PrimaryButton>
                  <p className="text-center text-[11px] text-black/40 dark:text-white/40">账号密码永久有效 · 清除浏览器数据后可随时重新登录</p>
                </>
              ) : (
                <>
                  <div className="relative">
                    <Field
                      icon={<Mail className="h-[18px] w-[18px]" />}
                      placeholder="注册邮箱"
                      value={loginEmail}
                      inputMode="email"
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                    <SendCodeButton countdown={countdown} busy={sending} onClick={() => sendCode('login')} />
                  </div>
                  <Field
                    icon={<KeyRound className="h-[18px] w-[18px]" />}
                    placeholder="6 位验证码"
                    value={loginCode}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <PrimaryButton busy={busy} onClick={submitLoginCode}>
                    <LogIn className="h-[18px] w-[18px]" />
                    临时登录（24 小时）
                  </PrimaryButton>
                  <p className="text-center text-[11px] text-black/40 dark:text-white/40">验证码登录为临时会话 · 账号密码登录永久有效</p>
                </>
              )}
            </div>
          )}

          {/* ---------- 注册 ---------- */}
          {mode === 'register' && (
            <div className="mt-4 flex flex-col gap-3">
              <Segment
                value={regTab}
                onChange={(v) => {
                  setRegTab(v);
                  setError('');
                }}
                options={[
                  { value: 'email', label: '邮箱验证码' },
                  { value: 'invite', label: '邀请码' },
                ]}
              />
              {regTab === 'email' ? (
                <>
                  <div className="relative">
                    <Field
                      icon={<Mail className="h-[18px] w-[18px]" />}
                      placeholder="QQ 邮箱（@qq.com）"
                      value={regEmail}
                      inputMode="email"
                      onChange={(e) => setRegEmail(e.target.value)}
                    />
                    <SendCodeButton countdown={countdown} busy={sending} onClick={() => sendCode('register')} />
                  </div>
                  <Field
                    icon={<UserPlus className="h-[18px] w-[18px]" />}
                    placeholder="用户名（选填，2~20 位）"
                    value={regName}
                    maxLength={20}
                    onChange={(e) => setRegName(e.target.value)}
                  />
                  <Field
                    icon={<KeyRound className="h-[18px] w-[18px]" />}
                    placeholder="设置密码（至少 6 位）"
                    type="password"
                    value={regPassword}
                    autoComplete="new-password"
                    onChange={(e) => setRegPassword(e.target.value)}
                  />
                  <Field
                    icon={<KeyRound className="h-[18px] w-[18px]" />}
                    placeholder="邮件中的 6 位验证码"
                    value={regCode}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) => setRegCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <PrimaryButton busy={busy} onClick={submitRegisterEmail}>
                    <UserPlus className="h-[18px] w-[18px]" />
                    注册
                  </PrimaryButton>
                  <p className="text-center text-[11px] text-black/40 dark:text-white/40">邮箱注册需管理员审核通过后解锁全部功能</p>
                </>
              ) : (
                <>
                  <Field
                    icon={<Ticket className="h-[18px] w-[18px]" />}
                    placeholder="邀请码（COVE-xxxx-xxxx，不区分大小写）"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.trim())}
                  />
                  <Field
                    icon={<UserPlus className="h-[18px] w-[18px]" />}
                    placeholder="用户名（2~20 位）"
                    value={inviteName}
                    maxLength={20}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                  <Field
                    icon={<KeyRound className="h-[18px] w-[18px]" />}
                    placeholder="设置密码（至少 6 位）"
                    type="password"
                    value={invitePassword}
                    autoComplete="new-password"
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                  <PrimaryButton busy={busy} onClick={submitRegisterInvite}>
                    <UserPlus className="h-[18px] w-[18px]" />
                    注册并进入
                  </PrimaryButton>
                  <p className="text-center text-[11px] text-black/40 dark:text-white/40">邀请码注册免审核 · 完成即解锁全部功能</p>
                </>
              )}
            </div>
          )}

          {/* 错误提示（内联红字） */}
          {error && (
            <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-center text-[12px] font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* 登录/注册切换提示 */}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="mt-4 w-full text-center text-[13px] font-medium text-white/85 transition-opacity active:opacity-60 [text-shadow:0_1px_4px_rgba(0,0,0,0.4)]"
        >
          {mode === 'login' ? '还没有账号？免费注册一个' : '已有账号？直接登录'}
        </button>
      </div>
    </div>
  );
}

// ---------------- 待审核强制拦截页（需求第二节） ----------------

/** 待审核账号登录后：仅展示审核等待提示，无任何功能入口；30 秒静默轮询，通过后自动解锁 */
export function PendingReviewScreen() {
  const refresh = useAuth((s) => s.refresh);
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);

  // 审核通过后刷新页面即可解锁 → 这里更进一步：30 秒轮询自动解锁（用户无感）
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-white px-8 text-center dark:bg-black">
      <div className="flex h-[86px] w-[86px] items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10">
        <Hourglass className="h-11 w-11 animate-pulse text-black/70 dark:text-white/70" strokeWidth={1.6} />
      </div>
      <p className="mt-7 text-[19px] font-semibold tracking-tight text-black dark:text-white">管理员正在审核，请稍后</p>
      <p className="mt-2 text-[13px] leading-relaxed text-black/45 dark:text-white/45">
        {user?.email || user?.name ? (
          <>
            账号：{user.email ?? user.name}
            <br />
          </>
        ) : null}
        审核通过后将自动解锁全部功能，无需重复登录
      </p>
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-12 text-[12px] font-medium text-black/35 transition-colors active:text-black/60 dark:text-white/35 dark:active:text-white/60"
      >
        退出登录
      </button>
    </div>
  );
}
