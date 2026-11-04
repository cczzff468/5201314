'use client';

/**
 * 音乐 App「一起听」聊天视图（第十四轮反馈按网易云真实界面重做）：
 * - TogetherChat：纯消息流（文字 + 推荐歌曲卡）——歌名行/头像/输入条/底部胶囊由播放器布局层负责；
 *   双方气泡同色（深灰半透明），AI 组织回复时显示三个跳动点；不显示逐条时间戳；
 * - TogetherChatInput：输入条（说点什么… + 笑脸/发送 + 语音圆钮）+ 推荐入口；
 * AI 回复/主动评论/记忆写入逻辑在 music-ai.ts；此组件纯视图 + 调用入口。
 */

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Loader2, Music4, RefreshCw, SendHorizonal, Smile } from 'lucide-react';
import { useMusic, getGuestAvatar } from '@/lib/ios/music-store';
import { retryTogetherReply, sendTogetherText, togetherRecommend, useTogetherLive } from '@/lib/ios/music-ai';
import { CoverImg } from './music-shared';

export function TogetherChat() {
  const msgs = useMusic((s) => s.togetherMsgs);
  const aiBusy = useMusic((s) => s.tgAiBusy);
  const playSong = useMusic((s) => s.playSong);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  // 对方信息跟随全局联系人（改头像/昵称立即同步）
  const together = useTogetherLive();
  const listRef = useRef<HTMLDivElement>(null);
  const cid = together?.contactId ?? '';
  const myAvatar = loginUid ? loginAvatar : getGuestAvatar();

  useEffect(() => {
    // 只滚动消息流容器自身（scrollIntoView 会冒泡滚动外层播放容器，把整页顶出屏幕）
    const box = listRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, aiBusy]);

  if (!together) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-white/50">
        一起听已结束
      </div>
    );
  }

  return (
    <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-testid="music-tg-msgs">
      {msgs.length === 0 && !aiBusy && (
        <p className="pt-6 text-center text-[12px] leading-relaxed text-white/40">
          {together.name} 接受了邀请，正在和你一起听歌
          <br />
          聊聊这首歌的感受吧
        </p>
      )}
      {msgs.map((m) => {
        // 旧版失败占位气泡（「……（信号不太好，没听清）」）不再渲染（用户需求：失败改红色 ! 徽标）
        if (m.role === 'peer' && m.error) return null;
        const mine = m.role === 'me';
        return (
          <div key={m.id} className={`flex items-end gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
            {mine ? (
              <CoverImg src={myAvatar} className="h-9 w-9 shrink-0" rounded="rounded-full" alt="我" />
            ) : (
              <CoverImg src={together.avatar} className="h-9 w-9 shrink-0" rounded="rounded-full" alt={together.name} />
            )}
            {mine && m.replyFail ? (
              <button
                type="button"
                aria-label="重新生成"
                data-testid={`music-tg-replyfail-${m.id}`}
                onClick={() => retryTogetherReply(cid, m.id)}
                className="mt-1 grid h-5 w-5 shrink-0 place-items-center self-center rounded-full bg-[#FA5151] text-[12px] font-bold leading-none text-white active:opacity-80"
              >
                !
              </button>
            ) : null}
            <div className={`flex max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
              {m.role === 'recs' && m.songs ? (
                <div className="w-[240px] rounded-2xl rounded-bl-md border border-white/15 bg-white/10 p-2.5 backdrop-blur-2xl">
                  <p className="px-0.5 pb-1.5 text-[12px] text-white/85">{m.text}</p>
                  <div className="space-y-1.5">
                    {m.songs.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          void playSong(
                            { id: s.id, name: s.name, fee: 0, artists: [{ id: 0, name: s.artist }], album: { id: 0, name: '', picUrl: s.picUrl } },
                            undefined,
                          )
                        }
                        data-testid={`music-tg-rec-${s.id}`}
                        className="flex w-full items-center gap-2 rounded-xl bg-white/10 p-1.5 text-left active:bg-white/15"
                      >
                        <CoverImg src={s.picUrl} className="h-9 w-9" rounded="rounded-md" alt={s.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] text-white/95">{s.name}</span>
                          <span className="block truncate text-[10px] text-white/45">{s.artist}</span>
                        </span>
                        <Music4 className="h-4 w-4 shrink-0 text-white/50" />
                      </button>
                    ))}
                  </div>
                  {/* 换一批（第二十二轮审计⑥）：不起新会话，直接让 TA 重新挑（避开最近推荐过的歌） */}
                  <button
                    type="button"
                    data-testid="music-tg-rec-refresh"
                    onClick={() => togetherRecommend(cid, '换一批，来点不一样的')}
                    disabled={aiBusy}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl py-1 text-[11px] text-white/55 active:bg-white/10 disabled:opacity-40"
                  >
                    <RefreshCw className="h-3 w-3" />
                    换一批
                  </button>
                </div>
              ) : (
                // 双方气泡同款深灰半透明（参考网易云真实一起听界面）；我的右侧、对方左侧
                <p
                  className={`whitespace-pre-wrap break-words rounded-2xl bg-white/10 px-3.5 py-2.5 text-[14px] leading-relaxed text-white/95 backdrop-blur-xl ${
                    mine ? 'rounded-br-md' : 'rounded-bl-md'
                  }`}
                >
                  {m.text}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* AI 正在组织回复：对方头像 + 三个跳动点气泡 */}
      {aiBusy && (
        <div className="flex items-end gap-2.5" data-testid="music-tg-typing">
          <CoverImg src={together.avatar} className="h-9 w-9 shrink-0" rounded="rounded-full" alt={together.name} />
          <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-white/10 px-4 py-3.5 backdrop-blur-xl">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/65" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/65 [animation-delay:-0.25s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/65 [animation-delay:-0.5s]" />
          </div>
        </div>
      )}
    </div>
  );
}

/** 一起听聊天输入条：说点什么…（右侧笑脸，有字时变红色发送钮）+ 语音圆钮；左侧保留「让 TA 推荐歌曲」入口 */
export function TogetherChatInput({ onToast }: { onToast?: (m: string) => void }) {
  const together = useTogetherLive();
  const [text, setText] = useState('');
  const [recBusy, setRecBusy] = useState(false);
  const cid = together?.contactId ?? '';

  const send = () => {
    if (!text.trim() || !cid) return;
    sendTogetherText(text.trim());
    setText('');
  };

  const askRecommend = () => {
    if (!cid || recBusy) return;
    setRecBusy(true);
    void togetherRecommend(cid, '给我推荐几首歌吧').finally(() => setRecBusy(false));
  };

  if (!together) return null;

  return (
    <div className="flex shrink-0 items-center gap-2.5 px-4 pb-2 pt-1">
      <button
        type="button"
        onClick={askRecommend}
        disabled={recBusy}
        data-testid="music-tg-recommend"
        aria-label="让 TA 推荐歌曲"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 backdrop-blur-xl disabled:opacity-50 active:scale-95"
      >
        {recBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music4 className="h-4 w-4" />}
      </button>
      <div className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-white/15 bg-white/10 pl-4 pr-2 backdrop-blur-2xl">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="说点什么..."
          data-testid="music-tg-input"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
        />
        {text.trim() ? (
          <button
            type="button"
            onClick={send}
            data-testid="music-tg-send"
            aria-label="发送"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EC4141] text-white active:scale-95"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-white/45">
            <Smile className="h-[18px] w-[18px]" />
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToast?.('语音消息即将上线')}
        aria-label="语音消息"
        data-testid="music-tg-voice"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/85 backdrop-blur-xl active:scale-95"
      >
        <AudioLines className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
