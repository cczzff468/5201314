'use client';

/**
 * 审核 App（管理员后台，内嵌 Cove 软件内、无需独立部署）：
 *
 * - 仅管理员及以上可见可进：主屏图标/Spotlight 已按角色过滤（HomeScreen 渲染层），
 *   本组件再守一层（角色丢失时显示无权限页），API 侧（/api/admin/*）为最终防线；
 * - Tab1 待审核：待审核用户邮箱列表 + 每条【通过审核】按钮（pending → approved，
 *   用户侧 30 秒轮询/刷新页面即解锁全部功能）；
 * - Tab2 邀请码：批量生成（1~50 个，格式 COVE-xxxx-xxxx 随机大小写字母+数字）、
 *   列表展示使用状态、一键复制（手动授权模式：私发给指定用户）；
 * - Tab3 用户管理（仅超级管理员可见——管理员不可以设管理员，机主定夺）：
 *   全部账号列表 + 【设为管理员】/【取消管理员】；超管本人显示金色徽章不可变更。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Copy,
  Crown,
  Hourglass,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  UserCog,
} from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { toast } from 'sonner';
import { isAdminRole, useAuth } from '@/lib/auth/store';
import { useUI } from '@/lib/ios/store';

interface PendingUser {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
}

interface InviteItem {
  id: string;
  code: string;
  used: boolean;
  usedBy: string | null;
  createdAt: string;
}

interface ManagedUser {
  id: string;
  email: string | null;
  name: string | null;
  role: 'user' | 'admin' | 'super_admin';
  status: 'pending' | 'approved';
  createdAt: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 角色徽章（超管金色 / 管理员灰 / 普通用户不显示） */
function RoleBadge({ role }: { role: ManagedUser['role'] }) {
  if (role === 'super_admin') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
        <Crown className="h-3 w-3" />
        超级管理员
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.07] px-2 py-0.5 text-[10px] font-bold text-black/60 dark:bg-white/10 dark:text-white/60">
        <ShieldCheck className="h-3 w-3" />
        管理员
      </span>
    );
  }
  return null;
}

export default function ReviewApp() {
  const user = useAuth((s) => s.user);
  const isAdmin = isAdminRole(user?.role);
  /** 用户管理 tab 仅超管可见（管理员不可以设管理员） */
  const isSuper = user?.role === 'super_admin';

  const [tab, setTab] = useState<'pending' | 'invites' | 'users'>('pending');
  const [pending, setPending] = useState<PendingUser[] | null>(null);
  const [invites, setInvites] = useState<InviteItem[] | null>(null);
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pending', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { users: PendingUser[] };
        setPending(data.users);
      } else {
        setPending([]);
      }
    } catch {
      setPending([]);
    }
  }, []);

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invites', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { invites: InviteItem[] };
        setInvites(data.invites);
      } else {
        setInvites([]);
      }
    } catch {
      setInvites([]);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { users: ManagedUser[] };
        setUsers(data.users);
      } else {
        setUsers([]);
      }
    } catch {
      setUsers([]);
    }
  }, []);

  /** 第四十五轮：三个统计卡（待审核 / 可用码 / 用户）的数值在打开即全部拉齐——
   *  旧版按 tab 懒加载，刚打开时只有「待审核」有数字，另外两个显示「—」，
   *  必须点下面的分段标签才出数（机主反馈「需要点击下面的才显示」）。 */
  useEffect(() => {
    if (!isAdmin) return;
    void loadPending();
    void loadInvites();
    if (isSuper) void loadUsers();
  }, [isAdmin, isSuper, loadPending, loadInvites, loadUsers]);

  // 通过审核：pending → approved（服务端二次校验管理员权限）
  const approve = async (u: PendingUser) => {
    setApproving(u.id);
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success(`已通过审核：${u.email ?? u.name ?? u.id}`);
        setPending((list) => (list ? list.filter((x) => x.id !== u.id) : list));
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络异常，请稍后重试');
    } finally {
      setApproving(null);
    }
  };

  // 批量生成邀请码（1~50）
  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/admin/invites/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: genCount }),
      });
      const data = (await res.json().catch(() => ({}))) as { codes?: string[]; error?: string };
      if (res.ok && data.codes) {
        toast.success(`已生成 ${data.codes.length} 个邀请码`);
        setInvites(null);
        void loadInvites();
      } else {
        toast.error(data.error || '生成失败');
      }
    } catch {
      toast.error('网络异常，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };

  // 设/撤管理员（仅超管；服务端 /api/admin/role 二次校验）
  const setRole = async (u: ManagedUser, role: 'admin' | 'user') => {
    setRoleBusy(u.id);
    try {
      const res = await fetch('/api/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.ok) {
        toast.success(`${data.message ?? '操作成功'}：${u.email ?? u.name ?? u.id}`);
        setUsers((list) => (list ? list.map((x) => (x.id === u.id ? { ...x, role } : x)) : list));
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络异常，请稍后重试');
    } finally {
      setRoleBusy(null);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    // 刷新 = 三个统计卡一起对账（顶部数字始终与列表一致）
    await Promise.all([loadPending(), loadInvites(), isSuper ? loadUsers() : Promise.resolve()]);
    setRefreshing(false);
  };

  // 防线兜底：角色异常（普通用户被路由进本 App）显示无权限页
  if (!isAdmin) {
    return (
      <IOSScreen>
        <div className="flex h-full w-full flex-col items-center justify-center px-10 text-center">
          <ShieldAlert className="h-12 w-12 text-black/40 dark:text-white/40" strokeWidth={1.6} />
          <p className="mt-4 text-[17px] font-semibold">无权限访问</p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">此界面仅管理员可用</p>
        </div>
      </IOSScreen>
    );
  }

  const tabs = [
    { value: 'pending' as const, label: '待审核用户' },
    { value: 'invites' as const, label: '邀请码管理' },
    ...(isSuper ? [{ value: 'users' as const, label: '用户管理' }] : []),
  ];

  return (
    <IOSScreen>
      <IOSNavBar
        title="审核"
        // 机主定稿：去掉左上「主界面」返回键——点导航栏「审核」两字即返回主界面
        onTitleClick={() => useUI.getState().closeApp()}
        inline
        right={
          <button
            type="button"
            aria-label="刷新"
            onClick={() => void refresh()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-black/60 transition-colors active:bg-black/10 dark:text-white/60 dark:active:bg-white/10"
          >
            <RefreshCw className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* 顶部统计 + 分段切换 */}
      <div className="flex shrink-0 flex-col gap-3 px-4 pb-2 pt-1">
        <div className="flex gap-2.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-2xl bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
            <Hourglass className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
            <span className="text-[12px] text-black/60 dark:text-white/60">待审核</span>
            <span className="ml-auto text-[17px] font-bold tabular-nums">{pending?.length ?? '—'}</span>
          </div>
          <div className="flex flex-1 items-center gap-1.5 rounded-2xl bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
            <Ticket className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
            <span className="text-[12px] text-black/60 dark:text-white/60">可用码</span>
            <span className="ml-auto text-[17px] font-bold tabular-nums">
              {invites ? invites.filter((i) => !i.used).length : '—'}
            </span>
          </div>
          {isSuper && (
            <div className="flex flex-1 items-center gap-1.5 rounded-2xl bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
              <UserCog className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
              <span className="text-[12px] text-black/60 dark:text-white/60">用户</span>
              <span className="ml-auto text-[17px] font-bold tabular-nums">{users?.length ?? '—'}</span>
            </div>
          )}
        </div>
        <div className="flex w-full rounded-full bg-black/[0.06] p-[3px] dark:bg-white/10">
          {tabs.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setTab(o.value)}
              className={`flex-1 rounded-full py-[7px] text-[13px] font-semibold transition-all ${
                tab === o.value
                  ? 'bg-background text-black shadow-sm dark:bg-[#3a3a3c] dark:text-white'
                  : 'text-black/50 dark:text-white/50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 列表区（flex-1 + 滚动，长列表不撑破屏幕） */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {tab === 'pending' ? (
          pending === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
            </div>
          ) : pending.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <BadgeCheck className="h-10 w-10 text-black/25 dark:text-white/25" strokeWidth={1.6} />
              <p className="text-[14px] text-black/40 dark:text-white/40">暂无待审核用户</p>
              <p className="text-[11px] text-black/30 dark:text-white/30">邮箱验证码注册的新用户会出现在这里</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-background px-4 py-3 dark:border-white/[0.08]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{u.email ?? '（无邮箱）'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-black/45 dark:text-white/45">
                      {u.name ? `用户名：${u.name} · ` : ''}申请于 {formatTime(u.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void approve(u)}
                    disabled={approving === u.id}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
                  >
                    {approving === u.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    通过审核
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'invites' ? (
          invites === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 批量生成 */}
              <div className="rounded-2xl border border-black/[0.06] bg-background p-3.5 dark:border-white/[0.08]">
                <p className="text-[12px] font-medium text-black/50 dark:text-white/50">
                  批量生成邀请码（COVE-xxxx-xxxx · 随机大小写字母+数字 · 单次使用）
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="flex rounded-full bg-black/[0.06] p-[3px] dark:bg-white/10">
                    {[5, 10, 20].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setGenCount(n)}
                        className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-all ${
                          genCount === n
                            ? 'bg-background text-black shadow-sm dark:bg-[#3a3a3c] dark:text-white'
                            : 'text-black/45 dark:text-white/45'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={generating}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-black text-[13px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-40 dark:bg-white dark:text-black"
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    一键批量生成
                  </button>
                </div>
              </div>

              {/* 邀请码列表 */}
              {invites.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-1.5">
                  <Ticket className="h-9 w-9 text-black/25 dark:text-white/25" strokeWidth={1.6} />
                  <p className="text-[13px] text-black/40 dark:text-white/40">还没有邀请码，点击上方按钮生成</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {invites.map((i) => (
                    <li
                      key={i.id}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                        i.used
                          ? 'border-black/[0.04] bg-black/[0.03] opacity-55 dark:border-white/[0.05] dark:bg-white/[0.03]'
                          : 'border-black/[0.06] bg-background dark:border-white/[0.08]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[15px] font-semibold tracking-wide">{i.code}</p>
                        <p className="mt-0.5 truncate text-[11px] text-black/45 dark:text-white/45">
                          {i.used ? `已使用${i.usedBy ? ` · ${i.usedBy}` : ''}` : `生成于 ${formatTime(i.createdAt)} · 可用`}
                        </p>
                      </div>
                      {!i.used && (
                        <button
                          type="button"
                          aria-label={`复制 ${i.code}`}
                          onClick={() => void copy(i.code)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/55 transition-colors active:bg-black/10 dark:text-white/55 dark:active:bg-white/10"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        ) : users === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[11px] text-black/40 dark:text-white/40">
              只有超级管理员能设置/取消管理员；管理员无法变更他人的管理员身份
            </p>
            <ul className="flex flex-col gap-2">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-background px-4 py-3 dark:border-white/[0.08]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[15px] font-semibold">{u.email ?? u.name ?? u.id}</p>
                      <RoleBadge role={u.role} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-black/45 dark:text-white/45">
                      {u.name ? `用户名：${u.name} · ` : ''}
                      {u.status === 'pending' ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">待审核</span>
                      ) : (
                        '已通过'
                      )}
                      {' · '}
                      注册于 {formatTime(u.createdAt)}
                    </p>
                  </div>
                  {u.role === 'super_admin' ? null : u.role === 'user' ? (
                    <button
                      type="button"
                      onClick={() => void setRole(u, 'admin')}
                      disabled={roleBusy === u.id}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-amber-600 px-3.5 text-[12px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
                    >
                      {roleBusy === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      设为管理员
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void setRole(u, 'user')}
                      disabled={roleBusy === u.id}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-black/15 px-3.5 text-[12px] font-semibold text-black/70 transition-transform active:scale-95 disabled:opacity-40 dark:border-white/20 dark:text-white/70"
                    >
                      {roleBusy === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserCog className="h-3.5 w-3.5" />
                      )}
                      取消管理员
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </IOSScreen>
  );
}
