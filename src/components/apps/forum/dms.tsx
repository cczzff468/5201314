'use client';

/**
 * X论坛 · 私信（X DMs）。
 * - DmsView 列表：论坛小助手（官方）+ 有过对话的作者；头像 + 最后一条预览 + 相对时间。
 * - DmThread 对话页：X 气泡（我方蓝底白字右侧、对方灰底左侧、rounded-2xl，无头像）；
 *   顶栏仅名字+handle（无头像）；底部输入条发送 → engine.queueDmReply 延迟回复
 *   （LLM 人设驱动，官方小助手不聊天）。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  forumData,
  forumSnapshot,
  activeAuthorKey,
  isUserAuthor,
  relTime,
  resolveAuthor,
  saveForum,
  subscribeForum,
  uid,
  type AuthorKey,
} from '@/lib/forum/core';
import { queueDmReply } from '@/lib/forum/engine';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';

export function DmsView() {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();

  const rows = useMemo(() => {
    return d.dms
      .map((dm) => ({ dm, peer: resolveAuthor(dm.peerKey), last: dm.messages[dm.messages.length - 1] }))
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }, [d]);

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      <div
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{
          borderColor: t.border,
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center justify-between px-4 pt-[54px]" style={{ height: 104 }}>
          <h1 className="text-[21px] font-extrabold">私信</h1>
          <button
            type="button"
            aria-label="私信说明"
            onClick={() => f.toast('在别人的主页点信封图标就能开聊')}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.settings(22)}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {rows.length === 0 && (
          <p className="px-10 pt-20 text-center text-[15px]" style={{ color: t.secondary }}>
            还没有私信。去别人的主页点信封图标开聊吧
          </p>
        )}
        {rows.map(({ dm, peer, last }) => (
          <button
            key={dm.peerKey}
            type="button"
            onClick={() => f.openDm(dm.peerKey)}
            className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors active:opacity-60"
            style={{ borderColor: t.border }}
          >
            <XAvatar authorKey={dm.peerKey} size={48} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-[15px] font-bold">{peer.name}</span>
                {peer.verified && <VerifiedBadge size={14} />}
              </span>
              <span className="mt-[1px] block truncate text-[14px]" style={{ color: t.secondary }}>
                {last ? last.text : '开始聊天'}
              </span>
            </span>
            <span className="shrink-0 text-[12px]" style={{ color: t.secondary }}>
              {last ? relTime(last.at) : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DmThread({ peerKey }: { peerKey: AuthorKey }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const peer = resolveAuthor(peerKey);
  const dm = d.dms.find((x) => x.peerKey === peerKey);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const messages = dm?.messages ?? [];
  const lastLen = messages.length;

  // 新消息自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lastLen]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const nd = forumData();
    let slot = nd.dms.find((x) => x.peerKey === peerKey);
    if (!slot) {
      slot = { peerKey, messages: [] };
      nd.dms.push(slot);
    }
    slot.messages.push({ id: uid('m'), from: activeAuthorKey(), text: text.slice(0, 200), at: Date.now() });
    saveForum({ ...nd });
    setDraft('');
    queueDmReply(peerKey);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏 */}
      <div
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{
          borderColor: t.border,
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-2 px-3 pt-[54px]" style={{ height: 104 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <button type="button" onClick={() => f.openProfile(peerKey)} className="flex min-w-0 flex-col items-start text-left">
            <span className="flex items-center gap-1">
              <span className="truncate text-[17px] font-bold">{peer.name}</span>
              {peer.verified && <VerifiedBadge size={14} />}
            </span>
            <span className="block text-[12px]" style={{ color: t.secondary }}>
              @{peer.handle}
            </span>
          </button>
        </div>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {messages.length === 0 && (
          <p className="pt-16 text-center text-[15px]" style={{ color: t.secondary }}>
            和 {peer.name} 的对话才开始，说点什么吧
          </p>
        )}
        {messages.map((m) => {
          const mine = isUserAuthor(m.from); // 大号/小号发的都在我方（气泡样式同侧，身份按账号隔离）
          return (
            <div key={m.id} className={`mb-3 flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <span
                className={`max-w-[76%] whitespace-pre-wrap break-words rounded-[20px] px-[14px] py-[10px] text-[15px] leading-[1.4] ${
                  mine ? 'text-white' : ''
                }`}
                style={
                  mine
                    ? { background: t.blue, color: '#fff', borderBottomRightRadius: 6 }
                    : { background: t.dark ? '#202327' : '#eff3f4', color: t.text, borderBottomLeftRadius: 6 }
                }
              >
                {m.text}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入条 */}
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: t.border, background: t.bg }}>
        <div className="flex min-w-0 flex-1 items-center rounded-full px-4 h-[42px]" style={{ background: t.dark ? '#202327' : '#eff3f4' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 200))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
            placeholder={peerKey === 'official' ? '给小助手留言（自动回复不支持闲聊）' : `发消息给 ${peer.name}…`}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: t.text, caretColor: t.blue }}
            aria-label="私信输入"
          />
        </div>
        <button
          type="button"
          aria-label="发送私信"
          disabled={!draft.trim()}
          onClick={send}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40 active:opacity-70"
          style={{ background: t.blue }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 2 11 13" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M22 2 15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
