'use client';

/**
 * 离线消息推送（第四十二轮机主规格：Supabase Realtime + 原生 Local Notification）：
 *
 * 链路：内置 IM 网关收到真机微信/QQ 新消息 → 除既有代答复外，同步向用户 Supabase 的
 * `messages` 表插一行（网关侧直写，见 mini-services/im-gateway）→ 本模块经
 * @supabase/supabase-js 的 supabase.channel() 订阅该表 INSERT 事件 →
 * ① App 在前台（visibilityState === 'visible'）：静默忽略——消息走既有渲染链路（聊天气泡），
 *    绝不发系统通知（机主规格原文）；
 * ② App 在后台/息屏（document.visibilityState !== 'visible'）：立刻经本地通知系统
 *    （system-notify：APK 原生通知栏直发 + 浏览器 SW showNotification 双通道）弹系统横幅，
 *    点击直达对应聊天。
 *
 * 启动：PhoneShell 开机后 ensureCloudNotify()（云端已部署 + 通知总闸开才连）；
 * @supabase/supabase-js 动态 import——不把它拖进首屏 bundle（SDK ~百 KB 级）。
 * 幂等单例；断线由 SDK 自动重连。凭证取 wx-cloud store（service key 直连用户自己的项目，
 * RLS bypass——个人自托管场景下的既定口径，与云端助手运行包同源）。
 */

import { wxCloudSnapshot } from './wx-cloud/store';
import { showSystemNotification } from './system-notify';

/** 消息表行（网关写入的结构；与 backup-setup 建表 SQL 一一对应） */
interface CloudMessageRow {
  id: string;
  created_at: string;
  channel: 'wx' | 'qq' | string;
  from_name: string;
  content: string;
  target?: string | null;
}

/** 通知系统总闸（与 notify-sse / island-notify 同键；就地重读避免循环 import） */
const SYS_NOTIFY_KEY = 'ios-sys-notify-enabled';
function sysNotifyEnabled(): boolean {
  try {
    return window.localStorage.getItem(SYS_NOTIFY_KEY) !== 'off';
  } catch {
    return true;
  }
}

let started = false;
let channel: { unsubscribe?: () => void } | null = null;
/** 去重：网关侧重试/Realtime 重连重播同一行 id 只通知一次 */
const seenIds = new Set<string>();

/** E2E 自测钩子（agent-browser 验证 Realtime 链路用；不参与业务） */
const debug = { connected: false, received: 0, notified: 0, last: null as CloudMessageRow | null };
if (typeof window !== 'undefined') {
  (window as unknown as { __cloudNotify?: typeof debug }).__cloudNotify = debug;
}

/** 通道徽标（状态栏小图标）：微信 / QQ */
function badgeOf(channel: string): string {
  return channel === 'qq' ? '/icons/qq.png' : '/icons/wechat.png';
}

/** 消息事件处理：前台静默 / 后台系统横幅（机主规格触发逻辑） */
async function onNewMessage(row: CloudMessageRow): Promise<void> {
  debug.received += 1;
  debug.last = row;
  if (!row.id || seenIds.has(row.id)) return; // Realtime 重播去重
  seenIds.add(row.id);
  // ① 前台：正常渲染聊天气泡（既有链路），不发系统通知
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  // ② 后台/息屏：原生 Local Notification 系统横幅
  try {
    const name = row.from_name?.trim() || (row.channel === 'qq' ? 'QQ 好友' : '微信好友');
    await showSystemNotification(name, {
      body: (row.content || '').slice(0, 120),
      tag: `cloud-${row.id}`,
      badge: badgeOf(String(row.channel ?? 'wx')),
      data: { target: row.target ? JSON.parse(row.target) : undefined },
    });
    debug.notified += 1;
  } catch {
    /* 通知失败静默（权限未授予等） */
  }
}

/**
 * 启动 Realtime 监听（幂等单例）：
 * - 需云端已部署（Supabase 凭证在位）+ 系统通知总闸开；
 * - 未就绪时静默跳过（之后设置页部署完成/开闸后下次调用自然连上）。
 */
export async function ensureCloudNotify(): Promise<boolean> {
  if (started || typeof window === 'undefined') return false;
  const st = wxCloudSnapshot();
  const supa = st.platform === 'supabase' ? st.supabase : null;
  if (!supa || !supa.deployedAt || !supa.projectUrl || !supa.serviceKey) return false;
  if (!sysNotifyEnabled()) return false;
  started = true;
  try {
    // 动态 import：SDK 不进首屏 bundle
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supa.projectUrl, supa.serviceKey, {
      realtime: { params: { eventsPerSecond: 2 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ch = supabase
      .channel('cove-offline-push')
      .on(
        'postgres_changes' as never,
        { event: 'INSERT', schema: 'public', table: 'messages' } as never,
        (payload: { new?: CloudMessageRow }) => {
          const row = payload?.new;
          if (row) void onNewMessage(row);
        },
      )
      .subscribe((status: string) => {
        debug.connected = status === 'SUBSCRIBED';
      });
    channel = ch as unknown as { unsubscribe?: () => void };
    return true;
  } catch (e) {
    started = false;
    console.warn('[cloud-notify] Realtime 连接失败（下次进 App 重试）:', String((e as Error)?.message ?? e).slice(0, 120));
    return false;
  }
}

/** 停止监听（目前无调用方；保留对称 API 供后续「推送开关」用） */
export function stopCloudNotify(): void {
  try {
    channel?.unsubscribe?.();
  } catch {
    /* ignore */
  }
  channel = null;
  started = false;
  debug.connected = false;
}
