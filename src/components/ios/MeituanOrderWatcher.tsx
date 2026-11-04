'use client';
/**
 * 美团订单全局调度器（挂在 PhoneShell，App 不打开也生效，对齐 ProactiveMsgWatcher 模式）：
 * - 每 4s 推进当前美团账号订单状态机（待支付超时取消 / 商家接单 / 骑手取餐 / 已送达）；
 * - 状态变化时派发 mt-orders-changed 事件刷新打开中的美团界面
 *   （取餐等状态弹窗不再弹白色毛玻璃通知卡——状态展示由美团灵动岛小窗/大窗负责，用户要求移除）；
 * - 订单终态（送达/取消）时给参与角色补写事件记忆（C9：买单史/代点史长期可忆）；
 * - 同步 pending 代付请求与订单真实状态（B4：订单取消/自行支付 → 请求失效，卡片/规则不再误导）；
 * - 未登录美团（无会话）时空转，零开销。
 */
import { useEffect } from 'react';
import { mtAdvanceOrders, mtGetSession, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';
import { mtSyncProxiesForUid } from '@/lib/ios/mt-proxy-pay';
import { mtWriteOrderTerminalMemory } from '@/lib/ios/mt-ai-engage';
// 第十六轮：跨 App 联动——外卖送达 → 恋人 AI 主动到微信/QQ 聊天里聊起
import { mtOrderArrivedNudge } from '@/lib/ios/cross-app-nudge';

export default function MeituanOrderWatcher() {
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      try {
        const s: MtSession | null = mtGetSession();
        if (!s) return;
        const uid = mtUidOf(s);
        const transitions = mtAdvanceOrders(uid);
        if (transitions.length === 0) return;
        // C9：终态订单 → 参与角色补写事件记忆（送达/取消各只推进一次，天然幂等）
        for (const tr of transitions) {
          if (tr.to === 'completed' || tr.to === 'canceled') mtWriteOrderTerminalMemory(tr.order);
          // 第十六轮：送达（completed）→ 跨 App 联动（恋人 AI 主动聊；幂等键含订单号，同单只发一次）
          if (tr.to === 'completed') mtOrderArrivedNudge(tr.order as unknown as Parameters<typeof mtOrderArrivedNudge>[0]);
        }
        // B4：订单状态变了（尤其取消/直付）→ 挂着的 pending 代付请求对齐真实状态
        mtSyncProxiesForUid(uid);
        window.dispatchEvent(new CustomEvent('mt-orders-changed'));
      } catch {
        /* 后台推进失败不打扰用户 */
      }
    };
    tick();
    const iv = setInterval(tick, 4000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}
