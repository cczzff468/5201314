'use client';

/**
 * 小屋 TA 说话的系统通知（页面隐藏时也弹，微信式「TA 发来消息」）：
 *
 * 背景：拾光小屋里 TA 的主动消息（讲梦/早安晚安/决策行动播报/好菜上桌/想你了等）与聊天回复
 * 都以「头顶 3D 气泡」上屏（CoupleHome → bubbleRef → HomeScene.HeadBubbles），页面切到后台时
 * 看不见也听不到。宿主文件 CoupleHome.tsx 由其他任务重构中不便挂钩，因此挂在共同下游
 * HeadBubbles：消费到 who='ta' 的普通说话气泡且 document.hidden 时，经 system-notify
 * （SW showNotification 优先 + 页面构造器兜底）补一条系统通知——切后台也能收到 TA 的消息。
 *
 * - 角色名/头像：localStorage cabin-companion-id → contacts-store（IndexedDB）单飞解析，
 *   会话内缓存；失败回退标题「TA」+ 无头像（通知完整可用）；
 * - 总闸：设置 › 通知「允许通知」关闭（isSysNotifyEnabled=false）不弹；
 *   showSystemNotification 自身还会校验 Notification.permission（未授权直接 no-op）；
 * - 页面可见时不弹（3D 气泡本身就是展示，不重复打扰）；全部失败静默（增强能力）。
 */

import { listContacts } from '@/lib/ios/contacts-store';
import { isSysNotifyEnabled } from '@/lib/ios/island-notify';
import { showSystemNotification } from '@/lib/ios/system-notify';

/** 当前陪伴角色 id（CoupleHome 选定角色时写入，本模块只读） */
const COMPANION_ID_KEY = 'cabin-companion-id';

interface CompanionBrief {
  name: string;
  icon?: string;
}

/** 会话内缓存（id → 展示名/头像）：换角色时 id 变化自动失效重查 */
let cachedId = '';
let cached: CompanionBrief | null = null;
let inflight: Promise<CompanionBrief | null> | null = null;

function currentCompanionId(): string {
  try {
    return window.localStorage.getItem(COMPANION_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 解析当前陪伴角色的展示名与头像（单飞 + 缓存；任何失败返回 null，调用方回退「TA」） */
async function resolveCompanion(): Promise<CompanionBrief | null> {
  const id = currentCompanionId();
  if (!id) return null;
  if (id === cachedId && cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const all = await listContacts();
        const c = all.find((x) => x.id === id);
        if (!c) return null;
        const icon = c.avatar ?? undefined;
        const brief: CompanionBrief = { name: c.name || 'TA', ...(icon ? { icon } : {}) };
        cachedId = id;
        cached = brief;
        return brief;
      } catch {
        return null; // IndexedDB 不可用等：静默降级
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/**
 * TA 气泡 → 隐藏页系统通知：
 * 仅页面隐藏时投递（可见时气泡已可见）；每条独立通知（tag 唯一不互相替换）；失败静默。
 */
export function notifyTaBubbleIfHidden(text: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (document.visibilityState !== 'hidden') return;
  // 系统级通知总闸（设置 › 通知）+ 浏览器授权双检查（showSystemNotification 还有第二道）
  if (!isSysNotifyEnabled() || Notification.permission !== 'granted') return;
  const body = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!body) return;
  void (async () => {
    const c = await resolveCompanion();
    await showSystemNotification(c?.name ?? 'TA', {
      body,
      tag: `cabin-${Date.now().toString(36)}`,
      icon: c?.icon,
      badge: '/icons/chat.png',
    }).catch(() => null);
  })();
}
