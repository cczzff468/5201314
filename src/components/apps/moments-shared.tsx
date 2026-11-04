'use client';

/**
 * 朋友圈 / QQ动态 共享 UI 组件（微信/QQ 两个 App 共用）：
 * - AskPostSheet「让TA发一条」：列出平台好友（CHAR/NPC），点行即让 TA 立即发一条动态（一.2）；
 *   行尾小齿轮进入该好友的自动发布设置（一.3/一.6）；
 * - MomentAutoCfgSheet：每角色×平台自动发动态设置——三种触发（定时 / 频率 / 聊天灵感，一.6）；
 * - EditPostDialog：编辑动态正文（六.4：用户可以编辑动态）。
 *
 * 样式约定：跟随宿主页面（absolute inset-0 的全屏页）内渲染，overlay z-50；
 * 深浅色都适配（与微信/QQ 页面同一套 dark: 前缀）。
 */

import { useMemo, useState, type ReactNode, useRef } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Heart, Languages, Loader2, MessageSquareQuote, Settings2, Sparkles, ThumbsUp, Trash2, X } from 'lucide-react';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { DefaultAvatar } from './default-avatar';
import {
  MOMENT_INTERVAL_OPTIONS,
  getMomentAutoCfg,
  listMomentPosts,
  saveMomentAutoCfg,
  type MomentAutoCfg,
  type MomentNotice,
  type MomentPlatform,
} from '@/lib/moments';

/** 平台好友（CHAR/NPC 且已添加为该平台好友） */
export function momentFriendsOf(contacts: ContactRecord[], platform: MomentPlatform): ContactRecord[] {
  return contacts.filter((c) => {
    if (c.kind !== 'char' && c.kind !== 'npc') return false;
    const v = platform === 'wx' ? c.friendWx : c.friendQq;
    return typeof v === 'boolean' ? v : !!c.isFriend;
  });
}

// ---------------- 「让TA发一条」好友选择弹层 ----------------

export function AskPostSheet({
  title,
  friends,
  busyId,
  onClose,
  onAsk,
  onOpenCfg,
  renderAvatar,
}: {
  title: string;
  friends: ContactRecord[];
  /** 正在生成中的联系人 id（行内转圈） */
  busyId: string | null;
  onClose: () => void;
  onAsk: (c: ContactRecord) => void;
  /** 传入 = 行尾显示设置齿轮 */
  onOpenCfg?: (c: ContactRecord) => void;
  /** 宿主 App 的头像组件（微信/QQ 各自的圆角风格） */
  renderAvatar?: (c: ContactRecord, size: number) => ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[70%] overflow-y-auto rounded-t-[16px] bg-white pb-6 dark:bg-[#1C1C1E]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between bg-white/95 px-4 py-3 backdrop-blur dark:bg-[#1C1C1E]/95">
          <span className="flex items-center gap-1.5 text-[15px] font-medium">
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {title}
          </span>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-full p-1 active:bg-black/5 dark:active:bg-white/10">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        {friends.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-black/35 dark:text-white/35">还没有好友，先去添加一个吧</p>
        ) : (
          friends.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 active:bg-black/[0.04] dark:active:bg-white/[0.06]">
              <button
                type="button"
                data-testid={`moments-ask-${c.id}`}
                onClick={() => onAsk(c)}
                disabled={busyId === c.id}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
              >
                {renderAvatar ? renderAvatar(c, 40) : <DefaultAvatar size={40} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{displayNameOf(c)}</span>
                  <span className="block text-[12px] text-black/35 dark:text-white/35">
                    {busyId === c.id ? '正在想发什么…' : '让 TA 现在发一条动态'}
                  </span>
                </span>
                {busyId === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-black/40 dark:text-white/40" aria-hidden="true" />}
              </button>
              {onOpenCfg && (
                <button
                  type="button"
                  aria-label={`${displayNameOf(c)}的自动发布设置`}
                  data-testid={`moments-cfg-${c.id}`}
                  onClick={() => onOpenCfg(c)}
                  className="shrink-0 rounded-full p-1.5 text-black/40 active:bg-black/5 dark:text-white/40 dark:active:bg-white/10"
                >
                  <Settings2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------- 自动发布设置弹层（每角色 × 每平台） ----------------

const TRIGGERS: { key: MomentAutoCfg['trigger']; label: string; desc: string; icon: ReactNode }[] = [
  { key: 'schedule', label: '定时发布', desc: '每天到点自动发一条', icon: <Clock3 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
  { key: 'interval', label: '按频率发布', desc: '每隔一段时间自动发一条', icon: <CalendarClock className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
  { key: 'chat', label: '聊天后有感而发', desc: '根据最近聊天和记忆，想发的时候就发', icon: <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
];

export function MomentAutoCfgSheet({
  contact,
  platform,
  platformLabel,
  onClose,
  onToast,
}: {
  contact: ContactRecord;
  platform: MomentPlatform;
  platformLabel: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [cfg, setCfg] = useState<MomentAutoCfg>(() => getMomentAutoCfg(contact.id, platform));

  const patch = (p: Partial<MomentAutoCfg>) => {
    const next = saveMomentAutoCfg(contact.id, platform, p);
    setCfg({ ...next });
    onToast('已保存');
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="自动发动态设置" onClick={onClose}>
      <div className="max-h-[80%] overflow-y-auto rounded-t-[16px] bg-white pb-8 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-4 py-3 backdrop-blur dark:bg-[#1C1C1E]/95">
          <span className="truncate text-[15px] font-medium">{displayNameOf(contact)} · 自动发{platformLabel}</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-full p-1 active:bg-black/5 dark:active:bg-white/10">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        {/* 总开关 */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-[15px]">自动发动态</span>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enabled}
            data-testid="moments-cfg-enabled"
            onClick={() => patch({ enabled: !cfg.enabled })}
            className={`relative h-[26px] w-[46px] rounded-full transition-colors ${cfg.enabled ? 'bg-[#07C160]' : 'bg-black/15 dark:bg-white/20'}`}
          >
            <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${cfg.enabled ? 'left-[22px]' : 'left-[2px]'}`} />
          </button>
        </div>

        {/* 触发方式（三选一，一.6） */}
        <div className={`px-4 pt-1 pb-2 text-[12.5px] text-black/35 dark:text-white/35 ${cfg.enabled ? '' : 'opacity-40'}`}>触发方式</div>
        <div className={cfg.enabled ? '' : 'pointer-events-none opacity-40'}>
          {TRIGGERS.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`moments-cfg-trigger-${t.key}`}
              onClick={() => patch({ trigger: t.key })}
              className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="mt-0.5 text-black/50 dark:text-white/50">{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{t.label}</span>
                <span className="block text-[12px] text-black/35 dark:text-white/35">{t.desc}</span>
              </span>
              <span
                className={`mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border ${
                  cfg.trigger === t.key ? 'border-[#07C160]' : 'border-black/20 dark:border-white/30'
                }`}
              >
                {cfg.trigger === t.key && <span className="h-[10px] w-[10px] rounded-full bg-[#07C160]" />}
              </span>
            </button>
          ))}

          {/* 子配置 */}
          {cfg.trigger === 'schedule' && (
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-[14px] text-black/60 dark:text-white/60">每天</span>
              <input
                type="time"
                aria-label="每天发布时间"
                data-testid="moments-cfg-time"
                value={`${String(cfg.hh).padStart(2, '0')}:${String(cfg.mm).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map((x) => Number(x));
                  if (Number.isFinite(h) && Number.isFinite(m)) patch({ hh: h, mm: m });
                }}
                className="rounded-[8px] border border-black/10 bg-white px-2 py-1.5 text-[14px] outline-none dark:border-white/15 dark:bg-[#2A2A2C]"
              />
              <span className="text-[14px] text-black/60 dark:text-white/60">自动发一条（错过时间会在下次打开时补发）</span>
            </div>
          )}
          {cfg.trigger === 'interval' && (
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-[14px] text-black/60 dark:text-white/60">每隔</span>
              <select
                aria-label="发布间隔"
                data-testid="moments-cfg-interval"
                value={cfg.intervalHours}
                onChange={(e) => patch({ intervalHours: Number(e.target.value) })}
                className="rounded-[8px] border border-black/10 bg-white px-2 py-1.5 text-[14px] outline-none dark:border-white/15 dark:bg-[#2A2A2C]"
              >
                {MOMENT_INTERVAL_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h < 24 ? `${h} 小时` : `${h / 24} 天`}
                  </option>
                ))}
              </select>
              <span className="text-[14px] text-black/60 dark:text-white/60">自动发一条</span>
            </div>
          )}
          {cfg.trigger === 'chat' && (
            <p className="px-4 py-2 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
              开启后，TA 会根据你们最近的聊天和 TA 的记忆库，随时心血来潮发一条「有感而发」的动态——不攒轮次、不设时间表，什么时候想发就发。
            </p>
          )}
          <p className="px-4 pt-1 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
            动态内容由 AI 根据「{displayNameOf(contact)}」的人设、你们的最近聊天和 TA 的记忆生成，不同角色风格不同。
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------- 编辑动态对话框 ----------------

export function EditPostDialog({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (content: string) => void;
}) {
  // initial 变化 = 父级换了一条动态编辑：调用方用 key={postId} 重挂载本组件，无需 effect 同步
  const [text, setText] = useState(initial);
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" role="dialog" aria-label="编辑动态" onClick={busy ? undefined : onCancel}>
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-medium">编辑动态</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          data-testid="moments-edit-input"
          aria-label="动态内容"
          className="mt-3 w-full resize-none rounded-[10px] bg-black/[0.04] p-3 text-[14.5px] leading-relaxed outline-none placeholder:text-black/30 focus:bg-black/[0.06] dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-white/[0.1]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[8px] px-3.5 py-1.5 text-[14px] text-black/60 active:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="moments-edit-save"
            onClick={() => onSave(text)}
            disabled={busy || !text.trim()}
            className="rounded-[8px] bg-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-white disabled:opacity-40 active:opacity-80"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 删除评论确认弹层（长按评论触发；微信/QQ 共用） ----------------

export function CommentDeleteDialog({
  author,
  onCancel,
  onDelete,
}: {
  /** 被删评论的作者名（提示文案用） */
  author: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" role="dialog" aria-label="删除评论" onClick={onCancel}>
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-medium">删除评论</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-black/55 dark:text-white/55">
          确定删除「{author}」的这条评论吗？它下面的回复也会一并删除。
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            data-testid="moments-comment-del-cancel"
            onClick={onCancel}
            className="rounded-[8px] px-3.5 py-1.5 text-[14px] text-black/60 active:bg-black/5 dark:text-white/60 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="moments-comment-del-confirm"
            onClick={onDelete}
            className="rounded-[8px] bg-[#FA5151] px-3.5 py-1.5 text-[14px] font-medium text-white active:opacity-80"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 单条动态「…」菜单（QQ 空间用；编辑/删除） ----------------

export function PostMoreMenu({
  onEdit,
  onDelete,
  onClose,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="动态操作" onClick={onClose}>
      <div className="pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-3 overflow-hidden rounded-[12px] bg-white dark:bg-[#1C1C1E]">
          <button type="button" data-testid="moments-post-edit" onClick={onEdit} className="flex h-[48px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.04] dark:border-white/10 dark:active:bg-white/[0.06]">
            <Settings2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            编辑动态
          </button>
          <button type="button" data-testid="moments-post-delete" onClick={onDelete} className="flex h-[48px] w-full items-center gap-2.5 px-4 text-left text-[15px] text-[#FA5151] active:bg-black/[0.04] dark:text-[#FF9A97] dark:active:bg-white/[0.06]">
            <Trash2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            删除动态
          </button>
        </div>
        <button type="button" onClick={onClose} className="mx-3 mt-2 flex h-[46px] w-[calc(100%-24px)] items-center justify-center rounded-[12px] bg-white text-[15px] font-medium active:bg-black/[0.04] dark:bg-[#1C1C1E] dark:active:bg-white/[0.06]">
          取消
        </button>
      </div>
    </div>
  );
}

/** 简单头像（无宿主头像组件时的兜底） */
export { ChevronRight };

// ---------------- 双语译文折叠/展开（微信朋友圈 + QQ 空间动态共用） ----------------

/** 双语译文折叠/展开组件（微信朋友圈 + QQ 空间动态共用）
 *  zh 为空串时不渲染；foldByDefault=true 时默认折叠，点击展开 */
export function BilingualTranslation({
  zh,
  foldByDefault,
}: {
  zh: string;
  foldByDefault: boolean;
}) {
  const [open, setOpen] = useState(!foldByDefault);
  if (!zh.trim()) return null;
  return (
    <div className="mt-1 text-[13.5px] text-black/55 dark:text-white/55">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] active:opacity-60"
        aria-label={open ? '收起译文' : '展开译文'}
      >
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{open ? '收起译文' : '展开译文'}</span>
      </button>
      {open && <p className="mt-1 leading-relaxed">{zh}</p>}
    </div>
  );
}

// ---------------- 表情面板（朋友圈/写说说 发布页共用：点选插入光标处） ----------------

/** 常用表情（纯 unicode，直接拼进动态正文；AI 生成的动态仍会剥 emoji，用户手选的不受限） */
export const MOMENT_EMOJIS: readonly string[] =
  '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 🤬 👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👏 🙌 🤝 🙏 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 💥 💫 🎉 🎊 🎁 🌹 🌸 🌼 🌻 ☀️ 🌈 ⭐ 🌙 ✨ 🔥 💧 🍉 🍓 🍦 🎂 ☕ 🍺 ⚽ 🏀 🎮 🎤 🎵 📱 💻 ✈️ 🚗 🌊 🏔️ 🎈 🐶 🐱 🐼 🐰 🦢 🌴'.split(
    ' '
  );

/** 表情面板（网格 + 关闭按钮；选中通过 onPick 交给宿主插入正文光标处） */
export function MomentsEmojiPanel({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div data-testid="moments-emoji-panel" className="overflow-hidden rounded-[12px] bg-black/[0.035] dark:bg-white/[0.06]">
      <div className="flex items-center justify-between px-3 pt-1.5">
        <span className="text-[12px] text-black/40 dark:text-white/40">表情</span>
        <button type="button" aria-label="收起表情" onClick={onClose} className="rounded-full p-1 text-black/40 active:bg-black/10 dark:text-white/40 dark:active:bg-white/10">
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <div className="max-h-[150px] overflow-y-auto px-2 pb-2 pt-1">
        <div className="grid grid-cols-8 gap-0.5">
          {MOMENT_EMOJIS.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              aria-label={`插入表情 ${e}`}
              data-testid={`moments-emoji-${i}`}
              onClick={() => onPick(e)}
              className="grid h-9 place-items-center rounded-[6px] text-[22px] leading-none active:bg-black/10 dark:active:bg-white/10"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 把表情插入 textarea 光标处（失焦/无光标时追加到末尾；插入后光标落到表情后面） */
export function insertEmojiAtCursor(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  emoji: string,
  setValue: (v: string) => void
): void {
  const el = ref.current;
  if (!el) {
    setValue(value + emoji);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  const next = value.slice(0, start) + emoji + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    try {
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    } catch {
      // 忽略
    }
  });
}

// ---------------- 互动消息页（微信「与我的互动消息」/ QQ「空间消息」共用） ----------------

/** 互动消息时间：今天 → HH:mm；昨天 → 昨天HH:mm；更早 → M月D日HH:mm */
function fmtNoticeTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return hm;
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yest)) return `昨天${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日${hm}`;
}

const QQ_NOTICE_TABS = ['全部', '赞和推', '评论和@', '转发', '官方', '其他'] as const;
type QqNoticeTab = (typeof QQ_NOTICE_TABS)[number];

function noticeMatchTab(n: MomentNotice, tab: QqNoticeTab): boolean {
  switch (tab) {
    case '全部':
      return true;
    case '赞和推':
      return n.kind === 'like';
    case '评论和@':
      return n.kind === 'comment' || n.kind === 'reply';
    case '转发':
      return n.kind === 'repost';
    case '官方':
      return n.kind === 'official';
    case '其他':
      return n.kind === 'system';
  }
}

/**
 * 互动消息页（双平台共用，variant 由 platform 决定）：
 * - wx「与我的互动消息」：谁赞了我（心形）/ 谁评论了我 / 回复了我；点行内展开回复框，点击可回复评论；
 * - qq「空间消息」：分类 tab（全部/赞和推/评论和@/转发/官方/其他）+ 每条含头像/昵称/时间/内容/原动态摘要 + 回复入口（输入框常驻）。
 * 回复提交走 onReply（宿主接引擎 addUserMomentComment，AI 会自动再回复）。
 */
export function MomentInteractionsPage({
  platform,
  title,
  notices,
  onBack,
  onReply,
  renderAvatar,
}: {
  platform: MomentPlatform;
  title: string;
  /** 收件箱列表（引擎 listMomentNotices 的结果，新消息在前） */
  notices: MomentNotice[];
  onBack: () => void;
  /** 提交回复（仅 comment/reply 消息会出现回复入口） */
  onReply: (notice: MomentNotice, text: string) => void;
  /** 宿主 App 的头像组件（微信/QQ 各自的圆角风格） */
  renderAvatar: (src: string | null, name: string, size: number) => ReactNode;
}) {
  const isWx = platform === 'wx';
  const [tab, setTab] = useState<QqNoticeTab>('全部');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** wx：展开回复框的消息 id（点行切换） */
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const replyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const shown = isWx ? notices : notices.filter((n) => noticeMatchTab(n, tab));
  // #41e：回复入口需要「目标仍然存活」——已删评论不再提供回复框（防「回复已删评论」在引擎侧
  // 降级成普通评论/回落动态作者），已删动态同理。动态/评论数据就地同步读取（组件与引擎同端运行），
  // 只校验收件箱里实际出现的 postId/commentId，开销与收件箱大小成正比；
  // notices 变化（宿主在 moments-changed 后刷新收件箱）即重算。
  const aliveTargets = useMemo(() => {
    const needComments = new Map<string, Set<string>>();
    const needPosts = new Set<string>();
    for (const n of notices) {
      if (n.kind !== 'comment' && n.kind !== 'reply') continue;
      if (!n.postId) continue;
      if (n.commentId) {
        const set = needComments.get(n.postId) ?? new Set<string>();
        set.add(n.commentId);
        needComments.set(n.postId, set);
      } else {
        needPosts.add(n.postId); // legacy 无 commentId：至少动态要还在
      }
    }
    const commentIds = new Set<string>();
    const postIds = new Set<string>();
    if (needComments.size > 0 || needPosts.size > 0) {
      try {
        for (const p of listMomentPosts(platform)) {
          if (needPosts.has(p.id)) postIds.add(p.id);
          const wanted = needComments.get(p.id);
          if (!wanted) continue;
          for (const c of p.comments) if (wanted.has(c.id)) commentIds.add(c.id);
        }
      } catch {
        // 读取失败 → 全部视为不可回（宁缺勿错）
      }
    }
    return { commentIds, postIds };
  }, [notices, platform]);
  const replyable = (n: MomentNotice) => {
    if ((n.kind !== 'comment' && n.kind !== 'reply') || !n.postId) return false;
    // 带 commentId（正常情况）：目标评论必须仍存在于对应动态的评论区（#41e）
    if (n.commentId) return aliveTargets.commentIds.has(n.commentId);
    return aliveTargets.postIds.has(n.postId);
  };

  const submitReply = (n: MomentNotice) => {
    const text = (drafts[n.id] ?? '').trim();
    if (!text || !replyable(n)) return;
    onReply(n, text);
    setDrafts((d) => ({ ...d, [n.id]: '' }));
    setReplyFor(null);
  };

  /** 消息正文行（like → 图标+赞了我；其余 → 内容文本） */
  const renderBody = (n: MomentNotice) => {
    if (n.kind === 'like') {
      return isWx ? (
        <span className="mt-0.5 block text-[#7B8BA6]" aria-label="赞了我">
          <Heart className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
        </span>
      ) : (
        <span className="mt-1 flex items-center gap-1.5 text-[15px] text-[#1E6FFF] dark:text-[#4AA3FF]">
          <ThumbsUp className="h-[17px] w-[17px] fill-current" strokeWidth={0} aria-hidden="true" />
          赞了我
        </span>
      );
    }
    if (n.kind === 'reply') {
      return (
        <p className="mt-0.5 text-[14.5px] leading-[1.5]">
          <span className="text-black/45 dark:text-white/45">{isWx ? '回复了我：' : `回复了${n.replyToName ?? '我'}的评论：`}</span>
          <span>{n.content}</span>
        </p>
      );
    }
    if (n.kind === 'repost') {
      return (
        <p className="mt-0.5 text-[14.5px] leading-[1.5]">
          <span className="text-black/45 dark:text-white/45">{isWx ? '转发了我的动态：' : '转发了我的动态'}</span>
          {n.content && <span className={isWx ? '' : ' block'}>{n.content}</span>}
        </p>
      );
    }
    if (n.kind === 'comment') {
      return <p className="mt-0.5 text-[14.5px] leading-[1.5]">{n.content}</p>;
    }
    // official / system
    return <p className="mt-0.5 text-[14.5px] leading-[1.5]">{n.content}</p>;
  };

  /** 原动态摘要（引用块；official 无原动态不渲染） */
  const renderQuote = (n: MomentNotice) => {
    if (!n.postSummary.trim()) return null;
    return (
      <div className="mt-2 rounded-[8px] bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]" data-testid={`notice-quote-${n.id}`}>
        <p className="line-clamp-2 text-[13.5px] leading-[1.5]">
          {n.postAuthorName && <span className="text-[#576B95] dark:text-[#8FA5C9]">{n.postAuthorName}：</span>}
          <span className="text-black/55 dark:text-white/55">{n.postSummary}</span>
        </p>
      </div>
    );
  };

  /** 回复输入区（qq 常驻；wx 点行展开） */
  const renderReplyBox = (n: MomentNotice) => {
    if (!replyable(n)) return null;
    if (isWx && replyFor !== n.id) return null;
    return (
      <div className="mt-2 flex items-center gap-2" data-testid={`notice-replybox-${n.id}`}>
        <input
          ref={(el) => {
            replyInputRefs.current[n.id] = el;
          }}
          value={drafts[n.id] ?? ''}
          onChange={(e) => setDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitReply(n);
            }
          }}
          placeholder={`回复${n.actorName}：`}
          aria-label={`回复${n.actorName}`}
          data-testid={`notice-reply-input-${n.id}`}
          className={`h-9 min-w-0 flex-1 rounded-[8px] bg-black/[0.04] px-3 text-[14px] outline-none placeholder:text-black/30 focus:bg-white focus:ring-1 focus:ring-black/10 dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-[#1F1F1F] dark:focus:ring-white/15 ${
            isWx ? '' : 'rounded-full border border-transparent focus:border-[#1E6FFF]/30 dark:focus:border-[#4AA3FF]/40'
          }`}
        />
        {(drafts[n.id] ?? '').trim() && (
          <button
            type="button"
            data-testid={`notice-reply-send-${n.id}`}
            onClick={() => submitReply(n)}
            className={`shrink-0 rounded-[8px] px-3 py-[7px] text-[13px] font-medium text-white active:opacity-80 ${isWx ? 'bg-[#07C160]' : 'bg-[#1E6FFF] dark:bg-[#1B6BDD]'}`}
          >
            发送
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`absolute inset-0 z-20 flex h-full w-full flex-col pt-[54px] ${isWx ? 'bg-[#F7F7F7] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F2F3F5] text-[#1F2329] dark:bg-[#111214] dark:text-white'}`}>
      {/* 顶栏：返回 + 居中标题 */}
      <div className={`relative flex h-11 shrink-0 items-center justify-center ${isWx ? 'bg-[#F7F7F7] dark:bg-[#111111]' : 'bg-white dark:bg-[#16171A]'}`}>
        <button
          type="button"
          aria-label="返回"
          data-testid="moments-notices-back"
          onClick={onBack}
          className="absolute left-2 rounded-full p-1.5 active:bg-black/[0.06] dark:active:bg-white/10"
        >
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
        </button>
        <span className="text-[16.5px] font-medium">{title}</span>
      </div>

      {/* QQ：分类 tab（全部/赞和推/评论和@/转发/官方/其他） */}
      {!isWx && (
        <div className="shrink-0 border-b border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#16171A]">
          <div className="flex items-center gap-6 overflow-x-auto px-4">
            {QQ_NOTICE_TABS.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`qq-notice-tab-${t}`}
                onClick={() => setTab(t)}
                className={`relative shrink-0 py-2.5 text-[15px] ${tab === t ? 'font-semibold text-[#1E6FFF] dark:text-[#4AA3FF]' : 'text-black/70 dark:text-white/70'}`}
              >
                {t}
                {tab === t && <span className="absolute inset-x-0 -bottom-px mx-auto h-[3px] w-6 rounded-full bg-[#1E6FFF] dark:bg-[#4AA3FF]" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`moments-notices-list-${platform}`}>
        {shown.length === 0 ? (
          <p className="mt-16 text-center text-[13.5px] text-black/30 dark:text-white/30">还没有消息</p>
        ) : (
          <div className="space-y-2 py-2">
            {shown.map((n) => (
              <div
                key={n.id}
                data-testid={`notice-row-${n.kind}-${n.id}`}
                onClick={() => {
                  // wx：点评论/回复行展开回复框（再点收起）
                  if (isWx && replyable(n)) setReplyFor((cur) => (cur === n.id ? null : n.id));
                }}
                className={`px-4 py-3 ${isWx ? 'bg-white dark:bg-[#1A1A1A]' : 'bg-white dark:bg-[#1B1C1F]'} ${!isWx && replyable(n) ? 'cursor-text' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {renderAvatar(n.actorAvatar, n.actorName, 44)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`truncate text-[15px] font-medium ${isWx ? 'text-[#576B95] dark:text-[#8FA5C9]' : 'text-[#4A78B8] dark:text-[#7FA8D9]'}`}>{n.actorName}</p>
                        <p className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{fmtNoticeTime(n.createdAt)}</p>
                      </div>
                      {!isWx && replyable(n) && (
                        <button
                          type="button"
                          data-testid={`notice-reply-btn-${n.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            replyInputRefs.current[n.id]?.focus();
                          }}
                          className="shrink-0 text-[14px] text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                        >
                          回复
                        </button>
                      )}
                    </div>
                    {renderBody(n)}
                  </div>
                  {/* wx：右侧原动态缩略图 */}
                  {isWx && n.postImage && <img src={n.postImage} alt="原动态配图" className="h-16 w-16 shrink-0 rounded-[2px] object-cover" />}
                </div>
                {renderQuote(n)}
                {renderReplyBox(n)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
