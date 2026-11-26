'use client';

/**
 * 账号系统客户端状态（Zustand）：
 * - phase：'loading'（首次拉取会话中）/ 'guest'（未登录）/ 'pending'（待审核，强制拦截）
 *   / 'authed'（已通过，解锁全部功能）——PhoneShell 按 phase 分流渲染；
 * - refresh：拉 /api/auth/me 同步状态（登录/注册/轮询解锁共用）；
 * - 登录态来自 HttpOnly Cookie（服务端持久），清浏览器数据只丢本地会话，
 *   账号与密码永远在服务器数据库——重新输入即可再登录。
 */

import { useEffect } from 'react';
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  /** user 普通用户 | admin 管理员（可审核/发邀请码）| super_admin 超级管理员（机主写死，可设管理员） */
  role: 'user' | 'admin' | 'super_admin';
  status: 'pending' | 'approved';
}

/** 是否管理员及以上（admin 或 super_admin）：审核 APP 可见性等前端过滤用 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export type AuthPhase = 'loading' | 'guest' | 'pending' | 'authed';

interface AuthState {
  user: AuthUser | null;
  phase: AuthPhase;
  /** 拉取会话；force=true 时即使已在拉取也再拉一次 */
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

function phaseOf(user: AuthUser | null): AuthPhase {
  if (!user) return 'guest';
  return user.status === 'approved' ? 'authed' : 'pending';
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  phase: 'loading',
  refresh: async () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { user: AuthUser };
          set({ user: data.user, phase: phaseOf(data.user) });
        } else {
          set({ user: null, phase: 'guest' });
        }
      } catch {
        // 网络异常：保持 loading，避免误判成 guest 闪登录页
        if (get().phase === 'loading') set({ phase: 'loading' });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
  setUser: (user) => set({ user, phase: phaseOf(user) }),
  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* 网络异常也照常清本地态 */
    }
    set({ user: null, phase: 'guest' });
  },
}));

/** 挂载时自动拉一次会话（PhoneShell 顶层使用） */
export function useAuthBoot(): void {
  useEffect(() => {
    void useAuth.getState().refresh();
  }, []);
}
