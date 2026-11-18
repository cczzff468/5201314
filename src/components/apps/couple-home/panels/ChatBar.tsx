'use client';

/**
 * v10.3 聊天输入条（文字胶囊 + 独立功能按钮排；消息进头顶气泡）
 * 对讲 / 聊天记忆 / 麦克风从输入胶囊拆出来独立成排（44px 触控圆钮）。
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { History, ImagePlus, Loader2, Mic, Radio, SendHorizontal } from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';

export interface ChatBarProps {
  mode: string;
  open: boolean;
  companion: ContactRecord | null;
  pickerOpen: boolean;
  photoChip: boolean;
  chatText: string;
  chatBusy: boolean;
  micOn: boolean;
  intercomOn: boolean;
  onChatText: (v: string) => void;
  onSend: () => Promise<void>;
  onMic: () => void;
  onIntercom: () => void;
  onOpenHistory: () => void;
  onPickPhoto: () => void;
}

export default function ChatBar({
  mode,
  open,
  companion,
  pickerOpen,
  photoChip,
  chatText,
  chatBusy,
  micOn,
  intercomOn,
  onChatText,
  onSend,
  onMic,
  onIntercom,
  onOpenHistory,
  onPickPhoto,
}: ChatBarProps) {
  return (
    <AnimatePresence>
      {mode === 'live' && open && companion && !pickerOpen && (
        <motion.div
          key="chat-bar"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-auto absolute bottom-[152px] left-1/2 z-30 w-[min(88%,352px)] -translate-x-1/2"
        >
          {photoChip && (
            <div className="mx-auto mb-1.5 w-fit rounded-full bg-white/80 dark:bg-zinc-900/80 px-3 py-1 text-[10.5px] text-[#b07193] dark:text-rose-300 shadow-sm ring-1 ring-white/70 dark:ring-white/15 backdrop-blur">
              已附照片 · 发送时 TA 会看到照片内容
            </div>
          )}
          {/* v10.3 独立功能按钮排：对讲 / 聊天记忆 / 麦克风（44px 触控圆钮，白玻璃质感） */}
          <div className="mb-1.5 flex items-center justify-end gap-1.5">
            {/* v10 E2 连续语音对讲：免打字对讲机模式 */}
            <button
              onClick={onIntercom}
              aria-label={intercomOn ? '关闭对讲模式' : '开启对讲模式'}
              aria-pressed={intercomOn}
              title="对讲模式：连续说话，每句自动发送"
              className={
                intercomOn
                  ? 'relative flex h-11 w-11 items-center justify-center rounded-full bg-[#5aa58a] text-white shadow-md transition active:scale-90'
                  : 'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#8a837a] dark:text-zinc-300 shadow-md backdrop-blur-xl transition active:scale-90'
              }
            >
              {intercomOn && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[#5aa58a]/35" />}
              <Radio className="h-[19px] w-[19px]" />
            </button>
            {/* v10 E1 聊天记录回看 */}
            <button
              onClick={onOpenHistory}
              aria-label="查看聊天记忆"
              title="和 TA 的聊天记忆"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#8a837a] dark:text-zinc-300 shadow-md backdrop-blur-xl transition active:scale-90"
            >
              <History className="h-[19px] w-[19px]" />
            </button>
            {/* 麦克风：点击说话，再点停止并自动发送（v10.3 支持服务端 ASR 兜底） */}
            <button
              onClick={onMic}
              aria-label={micOn ? '停止说话' : '开始说话'}
              aria-pressed={micOn}
              className={
                micOn
                  ? 'relative flex h-11 w-11 items-center justify-center rounded-full bg-[#e46a6a] text-white shadow-md transition active:scale-90'
                  : 'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 text-[#8a837a] dark:text-zinc-300 shadow-md backdrop-blur-xl transition active:scale-90'
              }
            >
              {micOn && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[#e46a6a]/35" />}
              <Mic className="h-[19px] w-[19px]" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70 p-1.5 pl-3.5 shadow-[0_10px_28px_rgba(90,70,60,0.22)] backdrop-blur-xl">
            <input
              value={chatText}
              onChange={(e) => onChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void onSend();
              }}
              placeholder={micOn ? '在听…请说话' : `跟${companion.name}说点什么…`}
              disabled={chatBusy}
              aria-label="和小屋里的TA聊天"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-[#3a3a3e] dark:text-zinc-100 outline-none placeholder:text-[#b8b2aa] dark:placeholder:text-zinc-500 disabled:opacity-50"
            />
            {/* 附照片（识图模型转文字注入情境） */}
            <button
              onClick={onPickPhoto}
              aria-label="发一张照片"
              title="发一张照片（识图）"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8a837a] dark:text-zinc-300 transition active:scale-90"
            >
              <ImagePlus className="h-[17px] w-[17px]" />
            </button>
            {/* 发送 */}
            <button
              onClick={() => void onSend()}
              disabled={!chatText.trim() || chatBusy}
              aria-label="发送"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4b3c2] text-white shadow transition active:scale-90 disabled:opacity-40"
            >
              {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
