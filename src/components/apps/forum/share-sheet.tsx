'use client';

/**
 * X论坛 · 帖子分享弹层（用户需求：点帖子下的分享图标 → 先选微信/QQ → 再选联系人 → 发送）。
 *
 * - 第一步选平台（微信/QQ 两大入口 + 复制链接兜底，保留旧分享能力）；
 * - 第二步从该平台好友里选 AI 角色（kind!=='user' 且该平台好友标记为真）；
 * - 发送调 shareForumPostToChat：帖子卡进聊天 + 写记忆 + 调度 AI 按人设回应；
 * - X 论坛主题配色（useXTheme），底部弹层动画与 ComposeSheet 同款 forum-sheet。
 */

import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Link2, Send } from 'lucide-react';
import { listContacts } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { shareForumPostToChat, postSnippet } from '@/lib/ios/forum-share';
import { resolveAuthor, type ForumPost } from '@/lib/forum/core';
import { XAvatar, useXTheme } from './shared';

/** 平台选项（真机分享面板口径：微信/QQ 双入口） */
const PLATFORMS: { v: 'wx' | 'qq'; name: string; icon: string; hint: string }[] = [
  { v: 'wx', name: '微信', icon: '/icons/wechat.png', hint: '分享给微信好友' },
  { v: 'qq', name: 'QQ', icon: '/icons/qq.png', hint: '分享给QQ好友' },
];

export function ForumShareSheet({
  post,
  toast,
  onClose,
}: {
  post: ForumPost;
  toast: (text: string) => void;
  onClose: () => void;
}) {
  const t = useXTheme();
  /** step：null = 关闭（父级已卸载）；'plat' = 选平台；'contact' = 选联系人 */
  const [step, setStep] = useState<'plat' | 'contact'>('plat');
  const [plat, setPlat] = useState<'wx' | 'qq' | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** 平台好友列表（第二步异步加载；列表与加载键一起落 state，切平台不闪旧列表） */
  const [loaded, setLoaded] = useState<{ key: string; list: ContactRecord[] | null }>({ key: '', list: null });
  const friends = loaded.key === `c:${step}:${plat ?? ''}` ? loaded.list : null;

  useEffect(() => {
    if (step !== 'contact' || !plat) return;
    let alive = true;
    listContacts()
      .then((all) => {
        if (alive) setLoaded({ key: `c:${step}:${plat}`, list: all.filter((c) => c.kind !== 'user' && isFriendIn(c, plat)) });
      })
      .catch(() => {
        if (alive) setLoaded({ key: `c:${step}:${plat}`, list: [] });
      });
    return () => {
      alive = false;
    };
  }, [step, plat]);

  const author = resolveAuthor(post.authorKey);
  const platName = plat === 'wx' ? '微信' : 'QQ';

  /** 发送：帖子卡进所选聊天 + 记忆 + AI 回复调度；成功后关面板 */
  const send = async () => {
    if (!plat || !contactId || sending) return;
    setSending(true);
    const res = await shareForumPostToChat({ postId: post.id, idp: plat, contactId });
    setSending(false);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    const c = friends?.find((x) => x.id === contactId);
    toast(`已分享给 ${c ? displayNameOf(c) : '好友'}，TA 稍后会回应你`);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="分享帖子">
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="关闭分享面板"
        className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 bottom-0 animate-[forum-sheet_.24s_ease-out] rounded-t-2xl pb-[max(20px,env(safe-area-inset-bottom))]"
        style={{ background: t.bg, color: t.text }}
      >
        {/* grabber */}
        <div className="flex justify-center pt-2" aria-hidden="true">
          <span className="h-[5px] w-9 rounded-full" style={{ background: t.dark ? '#2f3336' : '#eff3f4' }} />
        </div>

        {/* 标题 + 帖子摘要（分享什么一目了然） */}
        <div className="flex items-center gap-3 border-b px-5 pb-3 pt-3" style={{ borderColor: t.border }}>
          {step === 'contact' ? (
            <button
              type="button"
              aria-label="返回选择平台"
              onClick={() => {
                setStep('plat');
                setContactId(null);
              }}
              className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/5 dark:active:bg-white/5"
              style={{ color: t.text }}
            >
              <ChevronLeft size={22} strokeWidth={2.2} />
            </button>
          ) : (
            <XAvatar authorKey={post.authorKey} size={40} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold" style={{ color: t.text }}>
              {step === 'contact' ? `选择${platName}好友` : '分享帖子'}
            </p>
            <p className="mt-[2px] truncate text-[13px] leading-snug" style={{ color: t.secondary }}>
              {step === 'contact'
                ? `分享给${platName}好友，AI 会看过帖子并回应你`
                : `${author.name}：${postSnippet(post, 36)}`}
            </p>
          </div>
        </div>

        {step === 'plat' ? (
          <div className="px-5 pb-2 pt-4">
            {/* 平台双入口（真机分享面板口径） */}
            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => {
                    setPlat(p.v);
                    setContactId(null);
                    setStep('contact');
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl border py-4 transition-transform active:scale-[0.97]"
                  style={{ borderColor: t.dark ? '#536471' : '#cfd9de', background: t.hover }}
                  aria-label={`通过${p.name}分享`}
                >
                  <img src={p.icon} alt="" className="h-11 w-11 rounded-xl object-cover" />
                  <span className="text-[15px] font-semibold" style={{ color: t.text }}>
                    {p.name}
                  </span>
                  <span className="text-[12px]" style={{ color: t.secondary }}>
                    {p.hint}
                  </span>
                </button>
              ))}
            </div>
            {/* 复制链接（保留旧分享能力兜底） */}
            <button
              type="button"
              onClick={() => {
                try {
                  void navigator.clipboard?.writeText(`https://x.com/${author.handle}/status/${post.id}`);
                } catch {
                  /* 剪贴板不可用无妨 */
                }
                toast('链接已复制');
                onClose();
              }}
              className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-[12px] text-left transition-colors active:opacity-60"
              aria-label="复制帖子链接"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: t.hover, color: t.secondary }}>
                <Link2 size={19} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">复制链接</span>
                <span className="block text-[12px]" style={{ color: t.secondary }}>
                  复制后粘贴发给 AI 好友，TA 能看懂帖子与评论
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="px-5 pb-2 pt-3">
            {/* 好友列表（该平台 AI 好友；长列表限高滚动） */}
            <div className="forum-hide-scrollbar max-h-[44vh] overflow-y-auto">
              {friends === null ? (
                <p className="py-8 text-center text-[13px]" style={{ color: t.secondary }}>
                  正在获取{platName}好友列表…
                </p>
              ) : friends.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[14px]" style={{ color: t.text }}>
                    暂无{platName}好友
                  </p>
                  <p className="mt-1 text-[12px]" style={{ color: t.secondary }}>
                    先去{platName}App添加好友，再回来分享
                  </p>
                </div>
              ) : (
                friends.map((c) => {
                  const selected = contactId === c.id;
                  const av = avatarFor(c, plat ?? 'wx');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setContactId(c.id)}
                      aria-pressed={selected}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-[10px] text-left transition-colors"
                      style={{ background: selected ? (t.dark ? 'rgba(29,155,240,0.16)' : 'rgba(29,155,240,0.10)') : 'transparent' }}
                    >
                      {av ? (
                        <img src={av} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold"
                          style={{ background: t.hover, color: t.text }}
                        >
                          {displayNameOf(c).slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium" style={{ color: t.text }}>
                          {displayNameOf(c)}
                        </span>
                        {c.relation && (
                          <span className="block truncate text-[12px]" style={{ color: t.secondary }}>
                            {c.relation}
                          </span>
                        )}
                      </span>
                      <span
                        className="grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full border-2"
                        style={
                          selected
                            ? { borderColor: t.blue, background: t.blue, color: '#fff' }
                            : { borderColor: t.dark ? '#536471' : '#cfd9de' }
                        }
                        aria-hidden="true"
                      >
                        {selected && <Check size={13} strokeWidth={3.4} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {/* 发送按钮（X 蓝主按钮；未选好友置灰） */}
            <button
              type="button"
              disabled={!contactId || sending}
              onClick={() => void send()}
              className="mt-3 flex h-[46px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold text-white transition-opacity active:opacity-80 disabled:opacity-40"
              style={{ background: t.blue }}
              aria-label="发送分享"
            >
              {sending ? (
                <>
                  <span
                    className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                    style={{ borderColor: '#fff', borderTopColor: 'transparent' }}
                    aria-hidden="true"
                  />
                  正在发送…
                </>
              ) : (
                <>
                  <Send size={17} strokeWidth={2.2} />
                  发送给好友
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
