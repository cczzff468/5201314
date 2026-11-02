'use client';

/**
 * X论坛 · AI 真人社交 全局调度器：挂在 PhoneShell（论坛 App 不打开也照常调度），每 15s 心跳：
 * - runPending 重挂延迟任务（分钟~小时级的远期任务进入 90s 窗口时自动上 timer）；
 * - 活跃度开 → 每个角色按节奏排「主动发帖」任务（人设+情绪+记忆+今日事件素材）；
 * - 用户发帖/评论后排好的角色互动（点赞/评论/神回复）到点执行。
 *
 * 与 MomentsScheduler 同款模式：null 渲染组件 + setInterval 心跳 + alive/busy 双旗防重入。
 * 论坛未播种（从未打开过）时心跳直接返回——不强制初始化。
 */

import { useEffect } from 'react';
import { tickForumSocial } from '@/lib/forum/engine';

const TICK_MS = 15_000;

export default function ForumScheduler() {
  useEffect(() => {
    let alive = true;
    let busy = false;

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        await tickForumSocial();
      } catch {
        // 论坛是增强能力，任何异常静默（引擎内部已有静默保护）
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void tick(), TICK_MS);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
