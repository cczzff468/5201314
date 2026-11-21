'use client';

/**
 * 陪伴小人交互弹层三件套（从 CoupleHome.tsx 原样搬移，行为零变化）
 * - PartnerMenu：点小人弹出的环形菜单（拥抱 / 牵手 / 松开）
 * - PartnerRing：v11 I1 长按 TA 的互动轮盘（摸头 / 喂食 / 挠痒痒）
 * - RequestDialog：v8.0 AI 主动请求弹窗（「××想要拥抱你」：同意 / 拒绝）
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Feather, Hand, Heart, UtensilsCrossed, X } from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';

/** AI 主动请求（原主组件内联类型，抽出供面板与父组件共用） */
export interface CabinRequest {
  kind: 'hug' | 'holdhand' | 'meal' | 'chat' | 'miss';
  text?: string;
  at: number;
}

// ---------------- v8.0 陪伴小人环形菜单（点小人弹出：拥抱 / 牵手（牵手中=松开）） ----------------

export function PartnerMenu({
  mode,
  open,
  companion,
  holdingUI,
  onHug,
  onHold,
  onRelease,
  onClose,
}: {
  mode: string;
  open: boolean;
  companion: ContactRecord | null;
  holdingUI: boolean;
  onHug: () => void;
  onHold: () => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'live' && open && companion && (
        <motion.div
          key="partner-menu"
          initial={{ opacity: 0, scale: 0.9, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 6 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-auto absolute bottom-[224px] left-1/2 z-30 -translate-x-1/2"
          role="menu"
          aria-label={`${companion.name}互动菜单`}
        >
          <div className="flex items-center gap-2 rounded-full border border-white/70 dark:border-white/15 bg-white/85 dark:bg-zinc-900/80 p-2 shadow-[0_12px_30px_rgba(90,70,60,0.24)] backdrop-blur-xl">
            {holdingUI ? (
              <button
                onClick={onRelease}
                role="menuitem"
                className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#3a3a3e]/85 px-5 text-[13.5px] font-semibold text-white shadow transition active:scale-95"
              >
                <Hand className="h-[17px] w-[17px]" />
                松开手
              </button>
            ) : (
              <>
                <button
                  onClick={onHug}
                  role="menuitem"
                  className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#f4b3c2] px-5 text-[13.5px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95"
                >
                  <Heart className="h-[17px] w-[17px]" />
                  拥抱
                </button>
                <button
                  onClick={onHold}
                  role="menuitem"
                  className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[13.5px] font-semibold text-white shadow-md shadow-[#a8d4e6]/40 transition active:scale-95"
                >
                  <Hand className="h-[17px] w-[17px]" />
                  牵手
                </button>
              </>
            )}
            <button
              onClick={onClose}
              aria-label="关闭菜单"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-800/70 text-[#8a8a90] dark:text-zinc-300 ring-1 ring-white/80 dark:ring-white/15 transition active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- v11 I1 长按 TA 的互动轮盘（屏幕中下方半圆弧 · 白玻璃圆钮 · spring 弹入；点其他区域关闭） ----------------

export function PartnerRing({
  mode,
  open,
  companion,
  onPat,
  onFeed,
  onTickle,
  onClose,
}: {
  mode: string;
  open: boolean;
  companion: ContactRecord | null;
  onPat: () => void;
  onFeed: () => void;
  onTickle: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {mode === 'live' && open && companion && (
        <button aria-label="关闭互动轮盘" className="pointer-events-auto absolute inset-0 z-[61]" onClick={onClose} />
      )}
      <AnimatePresence>
        {mode === 'live' && open && companion && (
          <motion.div
            key="partner-ring"
            initial={{ opacity: 0, scale: 0.7, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 12 }}
            transition={{ type: 'spring', damping: 22, stiffness: 380 }}
            className="pointer-events-none absolute bottom-[214px] left-1/2 z-[62] -translate-x-1/2"
            role="menu"
            aria-label={`${companion.name}互动轮盘`}
          >
            <div className="relative h-[148px] w-[224px]">
                {/* 摸头（左下） */}
                <motion.button
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 420, delay: 0.03 }}
                  onClick={onPat}
                  role="menuitem"
                  aria-label="摸摸头"
                  className="pointer-events-auto absolute bottom-0 left-0 flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#6a5a62] dark:text-zinc-200 shadow-[0_10px_26px_rgba(90,70,60,0.22)] backdrop-blur-xl transition active:scale-90"
                >
                  <Hand className="h-[19px] w-[19px] text-[#e8a3b3]" />
                  <span className="text-[10px] font-semibold">摸头</span>
                </motion.button>
                {/* 喂食（中上） */}
                <motion.button
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 420, delay: 0.06 }}
                  onClick={onFeed}
                  role="menuitem"
                  aria-label="投喂食物"
                  className="pointer-events-auto absolute left-1/2 top-0 flex h-16 w-16 -translate-x-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#6a5a62] dark:text-zinc-200 shadow-[0_10px_26px_rgba(90,70,60,0.22)] backdrop-blur-xl transition active:scale-90"
                >
                  <UtensilsCrossed className="h-[19px] w-[19px] text-[#e0a458]" />
                  <span className="text-[10px] font-semibold">喂食</span>
                </motion.button>
                {/* 挠痒痒（右下） */}
                <motion.button
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 420, delay: 0.09 }}
                  onClick={onTickle}
                  role="menuitem"
                  aria-label="挠痒痒"
                  className="pointer-events-auto absolute bottom-0 right-0 flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#6a5a62] dark:text-zinc-200 shadow-[0_10px_26px_rgba(90,70,60,0.22)] backdrop-blur-xl transition active:scale-90"
                >
                  <Feather className="h-[19px] w-[19px] text-[#b89ad4]" />
                  <span className="text-[10px] font-semibold">挠痒痒</span>
                </motion.button>
                {/* 关闭（中下小圆钮） */}
                <motion.button
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 420, delay: 0.12 }}
                  onClick={onClose}
                  aria-label="关闭轮盘"
                  className="pointer-events-auto absolute bottom-1.5 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-800/70 text-[#8a8a90] dark:text-zinc-300 ring-1 ring-white/80 dark:ring-white/15 transition active:scale-90"
                >
                  <X className="h-4 w-4" />
                </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------- v8.0 AI 主动请求弹窗（「××想要拥抱你」：同意 / 拒绝） ----------------

export function RequestDialog({
  request,
  companion,
  onAccept,
  onReject,
}: {
  request: CabinRequest | null;
  companion: ContactRecord | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <AnimatePresence>
      {request && companion && (
        <motion.div
          key="ai-request"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
          role="dialog"
          aria-label={`${companion.name}的请求`}
        >
          <motion.div
            initial={{ scale: 0.9, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-[290px] rounded-3xl bg-white/95 dark:bg-zinc-900/95 p-5 text-center shadow-2xl backdrop-blur-xl"
          >
            <div className="mx-auto mb-2.5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[20px] font-bold text-white shadow-inner">
              {companion.name.slice(0, 1)}
            </div>
            <p className="text-[15px] font-semibold text-[#3a3a3e] dark:text-zinc-100">
              {companion.name}
              {request.kind === 'hug'
                ? '想要拥抱你'
                : request.kind === 'holdhand'
                  ? '想牵牵你的手'
                  : request.kind === 'meal'
                    ? '喊你来吃饭'
                    : request.kind === 'miss'
                      ? '说 TA 想你了'
                      : '有话想对你说'}
            </p>
            <p className="mb-4 mt-1 text-[11.5px] text-[#9a9a96] dark:text-zinc-400">
              {request.kind === 'hug'
                ? 'TA 张开了双臂，就站在你面前'
                : request.kind === 'holdhand'
                  ? 'TA 朝你伸出了手'
                  : request.kind === 'meal'
                    ? '一桌好菜已经端上桌，就等你啦'
                    : (request.text ?? '点同意，TA 就会走到你身边')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onReject}
                className="h-11 flex-1 rounded-full bg-[#f1efe9] dark:bg-zinc-800 text-[13.5px] font-semibold text-[#8a8a86] dark:text-zinc-400 transition active:scale-95"
              >
                拒绝
              </button>
              <button
                onClick={onAccept}
                className="h-11 flex-1 rounded-full bg-[#f4b3c2] text-[13.5px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95"
              >
                同意
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
