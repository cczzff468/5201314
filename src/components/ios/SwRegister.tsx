'use client';

/**
 * Service Worker 启动注册器（PWA 可安装 + 推送前置）：
 *
 * 此前 /sw.js 只在「通知权限已 granted」后由 push-client（island-notify 触发）注册——
 * 权限处于默认态（从未弹过授权框）时 SW 永不注册，浏览器判定不满足可安装条件（无 SW），
 * 且推送订阅链路也无从谈起。这里补上「应用启动即注册」：
 * - 复用 system-notify 的 ensureSwRegistration（与推送订阅 / 系统通知共用同一注册口与
 *   Promise 缓存，不会双注册竞态），/sw.js 本身只挂 push/notificationclick 处理器，
 *   提前注册无缓存等副作用；
 * - StrictMode 双挂载 / 重复挂载均幂等（ensureSwRegistration 内部有同 scope 复用 + 缓存）；
 * - iframe / 不支持的浏览器注册失败静默（推送与安装均为尽力而为的增强能力，
 *   应用内灵动岛弹窗不受影响）。
 */

import { useEffect } from 'react';
import { ensureSwRegistration } from '@/lib/ios/system-notify';

export default function SwRegister() {
  useEffect(() => {
    // ensureSwRegistration 内部已 try/catch 兜底，永不 reject；此处 void 即可
    void ensureSwRegistration();
  }, []);
  return null;
}
