'use client';

/**
 * v1.9.12 聊天列表自动滚动（全端共享：信息/微信/QQ/群聊/淘宝客服/X论坛私信/一起听/情侣空间）。
 *
 * 机主规格（聊天滚动体验重做）：
 * 1. 进入聊天（首次渲染）：立即、无动画停在底部（scrollTop 直赋值，不走 smooth）；
 * 2. 发送文字/语音：无论列表滚到哪里，立刻自动滚到最底部（mine 标记的最后一条消息触发强制滚底）；
 * 3. 接收 AI 新消息：
 *    - 机主停在底部附近（距底 ≤ threshold）→ 跟随滚底，最新内容永远在可视范围；
 *    - 机主正上翻看历史 → 绝不拽回底部，改为在列表底部浮出「有新消息 ⬇️」轻提示，
 *      点击才滚到底（ChatNewMsgPill）；
 * 4. 键盘弹起（visualViewport 变矮）：此前贴底的会话重新贴底，输入框与最新消息不被遮挡。
 *
 * 滚底签名守卫（沿用各端原实现）：仅结构性变化（条数/末条 id/流式内容）才评估滚动，
 * 转文字等原地更新（msgs 引用变但结构不变）不触发，避免转写面板出现时气泡被拽上移。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

/** 距底多少像素以内算「贴着底部」 */
export const NEAR_BOTTOM_PX = 160;

export interface ChatAutoScrollApi {
  /** 挂到滚动容器（overflow-y-auto 的消息列表）上 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 手动滚到最底部（瞬时，无动画；并撤掉「有新消息」提示） */
  scrollToBottom: () => void;
  /** 有新消息但机主正在看历史时为 true（渲染 ChatNewMsgPill 用） */
  showNewMsg: boolean;
}

/**
 * @param sig 滚底签名：`${msgs.length}:${末条id}:${流式内容}`（结构变化才触发评估）
 * @param opts.mine 末条消息是否机主本人发送（发送路径强制滚底的依据）
 * @param opts.threshold 贴底判定距离（默认 160px；消息气泡高的界面可调大）
 */
export function useChatAutoScroll(sig: string, opts?: { mine?: boolean; threshold?: number }): ChatAutoScrollApi {
  const threshold = opts?.threshold ?? NEAR_BOTTOM_PX;
  const mine = opts?.mine ?? false;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sigRef = useRef('');
  /** mine 经 ref 读：滚动 effect 依赖只有 sig，避免 mine 每次渲染重跑 */
  const mineRef = useRef(false);
  const [showNewMsg, setShowNewMsg] = useState(false);

  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）；本 effect 声明在滚动 effect 之前，
  // 同一次提交内先执行，滚动 effect 读到的必是本帧最新值
  useEffect(() => {
    mineRef.current = mine;
  });

  // 机主手动滚回底部附近 → 撤掉「有新消息」提示
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) setShowNewMsg(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [threshold]);

  // 键盘弹起（visualViewport 变矮）：此前贴底的会话重新贴底，最新消息不被键盘遮挡；
  // 正在看历史（距底远）不打扰。 iOS/Android 浏览器在 interactive-widget=resizes-content
  // 下布局高度会随键盘收缩，重贴底保证输入条与底部消息同屏可见
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => {
      const el = scrollRef.current;
      if (!el) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap < threshold * 4) el.scrollTop = el.scrollHeight;
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [threshold]);

  useEffect(() => {
    if (sig === sigRef.current) return;
    const first = sigRef.current === '';
    sigRef.current = sig;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      // 首次进入/贴底跟随/机主发送 → 立即滚底（scrollTop 直赋值，无滚动动画）；
      // 机主在看历史 → 不拽回，浮出「有新消息」轻提示
      if (first || gap < threshold || mineRef.current) {
        el.scrollTop = el.scrollHeight;
        setShowNewMsg(false);
      } else {
        setShowNewMsg(true);
      }
    });
  }, [sig, threshold]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowNewMsg(false);
  }, []);

  return { scrollRef, scrollToBottom, showNewMsg };
}

/**
 * 「有新消息 ⬇️」轻提示胶囊：放在滚动容器内作为**最后一个子元素**（sticky bottom 吸底，
 * 随消息流定位，无需每个 App 自己量输入条高度）。机主在看历史时浮出，点击滚到最底部。
 */
export function ChatNewMsgPill({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="chat-new-msg-pill"
          initial={{ opacity: 0, y: 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.92 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="pointer-events-none sticky bottom-2 z-20 flex justify-center"
        >
          <button
            type="button"
            aria-label="滚动到最新消息"
            data-testid="chat-new-msg-pill"
            onClick={onClick}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-md transition-opacity active:opacity-70"
          >
            有新消息
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
