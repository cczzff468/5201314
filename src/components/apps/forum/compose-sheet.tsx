'use client';

/**
 * X论坛 · 发布弹层（X compose 全屏 sheet，按用户需求精修 + 全功能开发）。
 *
 * 布局：
 * - 顶行：返回箭头 | 「发布」胶囊（空文浅蓝 #a9d4f5、可发亮蓝；草稿按钮已按需求移除）；
 * - 正文区：40px 头像 + 「有什么新鲜事？」20px 大输入；
 * - 媒体预览：2 列网格 + 右上删除角标（相册/文字图片，最多 4 张）；
 * - 投票编辑卡：选项 2~4 条，可增删（工具栏投票开关）；
 * - 隐私行/版块胶囊已按用户要求移除（「所有人都可以回复」与「今日热议」不再展示）；
 * - 工具行（细分隔线上方）：相册（手机上传/文字图片二选一）/ 投票 / 表情 / 定时 / 位置 / 旗子(话题)
 *   未激活灰色线条（用户指定），激活蓝底白图标 + 字数圆环；
 * - 底行：左下灰色圆角「全屏」方块（写作模式）+ 定时/位置状态芯片（图标化美化）。
 *
 * 数据出参 ComposePayload：media / poll / location / visibleAt（定时帖）。
 * 话题面板：支持自定义话题输入 + 热门话题列表。
 * v9：GIF·动图搜索已按用户要求移除；文字图片移除「iMessage HH:mm」时间戳
 * （渲染逻辑迁至 lib/forum/textimg.ts，与 AI 生成帖配图同源）。
 */

import { useRef, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Flag,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Smile,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import { activeAuthorKey, trendingTopics, forumData, POST_MAX } from '@/lib/forum/core';
import { renderTextImage, TEXTIMG_MAX_LEN } from '@/lib/forum/textimg';
import { generateFreePhoto, imgGenConfigReady } from '@/lib/imggen';
import { useSettings, useUI } from '@/lib/ios/store';
import { XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

/** 发布字数上限（v13 用户要求：帖子 30~1000 字；与数据层 POST_MAX 同步 = 1000） */
const LIMIT = POST_MAX;
const SW = 1.9;
const MAX_MEDIA = 4;

/** 发布扩展内容（forum.tsx publish 回调的第三参） */
export interface ComposePayload {
  media?: string[];
  /** 文字图片源文本（与 media 按下标对齐；文字图项存原文，其余为 ''）——
  *  发布后点击卡片生成真图时预填提示词 */
  mediaText?: string[];
  poll?: { options: string[] };
  location?: string;
  visibleAt?: number;
}

/** emoji 面板内容（常用社交表情，8 列滚区） */
const EMOJI_SET = [
  '😄', '😂', '🥰', '😭', '🤔', '👏', '🙌', '🙏',
  '🔥', '✨', '💙', '❤️', '🎉', '🎊', '💯', '🤝',
  '😅', '😊', '😉', '😴', '🥱', '🤗', '😎', '🫡',
  '🐶', '🐱', '🍜', '🍰', '☕', '🍵', '🍺', '🌈',
];

/** 定时快捷项（相对当前时间计算；X 官方定时发布风格） */
function schedulePresets(): { label: string; at: number }[] {
  const now = new Date();
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: '1 小时后', at: in1h.getTime() },
    { label: '今晚 20:00', at: tonight.getTime() },
    { label: '明天上午 9:00', at: tomorrow9.getTime() },
  ];
}

/** 文字图片渲染已迁至 lib/forum/textimg.ts（与 AI 生成帖配图同源；
 *  v9 按用户要求移除「iMessage HH:mm」时间戳行，成品只有正文本身） */

const fmtSchedule = (at: number) =>
  new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 相册文件 → 压缩 dataURL（长边 1080 / JPEG 0.72；GIF 原样保留动画） */
function fileToPostMedia(file: File): Promise<string> {
  if (file.type === 'image/gif') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('读取失败'));
      r.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const long = 1080;
        const scale = Math.min(1, long / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/** X 字数圆环（剩余量；≤200 转橙，<0 变红；长上限下按剩余百分比计） */
function Ring({ left }: { left: number }) {
  const t = useXTheme();
  if (left >= LIMIT) return null;
  const r = 9;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, left / LIMIT));
  const stroke = left < 0 ? '#f4212e' : left <= 200 ? '#ffa500' : t.blue;
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" stroke={t.border} strokeWidth="2" />
      {left > 0 && (
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray={`${(c * ratio).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 12 12)"
          strokeLinecap="round"
        />
      )}
      {left <= 200 && (
        <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill={left < 0 ? '#f4212e' : stroke}>
          {left < 0 ? '' : left}
        </text>
      )}
    </svg>
  );
}

export function ComposeSheet({
  onClose,
  onPublish,
}: {
  onClose: () => void;
  onPublish: (text: string, community: string | null, extras?: ComposePayload) => void;
}) {
  const f = useForum();
  const t = f.t;
  const [text, setText] = useState('');
  const [media, setMedia] = useState<string[]>([]);
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [visibleAt, setVisibleAt] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState<null | 'gallery' | 'emoji' | 'schedule' | 'geo' | 'topic' | 'textimg'>(null);
  const [geoInput, setGeoInput] = useState('');
  const [customSchedule, setCustomSchedule] = useState('');
  /** 自定义话题输入（话题面板顶部） */
  const [customTopic, setCustomTopic] = useState('');
  /** 文字图片输入（相册弹层第三入口） */
  const [textImgInput, setTextImgInput] = useState('');
  /** 文字图片源文本（与 media 按下标对齐；文字图项存原文、其余 ''，
  *  发布时随 ComposePayload 带出 → 点击卡片生图预填提示词） */
  const [mediaText, setMediaText] = useState<string[]>([]);
  /** 文字图片弹层模式：'text' = 经典白底文字图；'ai' = AI 生图（自定义提示词→真图） */
  const [imgMode, setImgMode] = useState<'text' | 'ai'>('text');
  /** AI 生图：自定义提示词 */
  const [aiImgPrompt, setAiImgPrompt] = useState('');
  /** AI 生图进行中 */
  const [aiImgBusy, setAiImgBusy] = useState(false);

  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const left = LIMIT - text.length;
  const validPoll =
    pollOptions !== null && pollOptions.filter((o) => o.trim()).length >= 2 && pollOptions.length <= 4;
  const canPublish = (text.trim().length > 0 || media.length > 0) && left >= 0 && (!pollOptions || validPoll);

  /** 工具行图标按钮（功能按钮灰色线条；激活时蓝底白图标显示开关状态） */
  const toolBtn = (label: string, active: boolean, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/5 dark:active:bg-white/10"
      style={{ color: active ? '#fff' : t.secondary, background: active ? t.blue : 'transparent' }}
    >
      {icon}
    </button>
  );

  /** 追加媒体（超上限给 toast）；srcs 与 items 按下标对齐（文字图项源文本，其余 ''） */
  const addMedia = (items: string[], srcs?: string[]) => {
    setMedia((cur) => {
      const next = [...cur, ...items].slice(0, MAX_MEDIA);
      if (cur.length + items.length > MAX_MEDIA) f.toast(`最多 ${MAX_MEDIA} 张图片`);
      return next;
    });
    setMediaText((cur) => {
      const add = items.map((_, i) => (srcs && i < srcs.length ? srcs[i] : '')).slice(0, MAX_MEDIA);
      return [...cur, ...add].slice(0, MAX_MEDIA);
    });
  };

  /** 相册选择 */
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const jobs = Array.from(files)
      .slice(0, MAX_MEDIA)
      .map((file) =>
        fileToPostMedia(file)
          .then((url) => url)
          .catch(() => {
            f.toast('有图片处理失败，换一张试试');
            return null as string | null;
          }),
      );
    void Promise.all(jobs).then((urls) => {
      const ok = urls.filter((u): u is string => Boolean(u));
      if (ok.length) {
        addMedia(ok);
        f.toast('图片已添加');
      }
    });
  };

  /** 插入表情 */
  const insertEmoji = (e: string) => {
    setText((s) => (s.length + e.length > LIMIT ? s : s + e));
  };

  /** AI 生图：自定义提示词 → 真图（走全局生图模型配置；未配置给入口引导） */
  const genAiImage = async () => {
    const prompt = aiImgPrompt.trim();
    if (!prompt || aiImgBusy) return;
    const cfg = useSettings.getState().imgGenConfig;
    if (!imgGenConfigReady(cfg)) {
      f.toast('先配置生图模型（设置 › 图像生成）');
      return;
    }
    setAiImgBusy(true);
    try {
      const src = await generateFreePhoto(cfg, prompt);
      addMedia([src]);
      setSheet(null);
      setAiImgPrompt('');
      f.toast('图片已生成，发布后可见');
    } catch (e) {
      f.toast(e instanceof Error ? e.message : '生成失败，稍后再试');
    } finally {
      setAiImgBusy(false);
    }
  };

  /** 跳去系统设置 › 图像生成（配置生图模型） */
  const gotoImgGenSettings = () => {
    const ui = useUI.getState();
    ui.setPendingSettingsPage('imggen');
    ui.switchToApp('settings');
  };

  /** 话题（旗子）：文末追加 #话题# */
  const appendTopic = (tag: string) => {
    setText((s) => {
      const piece = `#${tag}#`;
      if (s.includes(piece)) return s;
      const next = (s ? (s.endsWith(' ') || s.endsWith('\n') ? s : `${s} `) : '') + piece;
      return next.length > LIMIT + 40 ? s : next;
    });
    setSheet(null);
    f.toast('已插入话题标签');
  };

  const publish = () => {
    if (!canPublish) {
      if (pollOptions && !validPoll) f.toast('投票至少需要 2 个非空选项');
      return;
    }
    onPublish(text.trim(), null, {
      media: media.length ? media : undefined,
      mediaText: media.length && mediaText.some((s) => s.trim()) ? mediaText.slice(0, media.length) : undefined,
      poll: pollOptions && validPoll ? { options: pollOptions.filter((o) => o.trim()) } : undefined,
      location: location ?? undefined,
      visibleAt: visibleAt && visibleAt > Date.now() ? visibleAt : undefined,
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="发布帖子">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 发布胶囊（空文浅蓝、可发亮蓝；按用户要求已移除「草稿」） */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-[54px]" style={{ height: 100 }}>
          {full ? (
            <>
              <span className="text-[17px] font-bold">有什么新鲜事？</span>
              <button
                type="button"
                onClick={() => setFull(false)}
                className="flex h-[32px] items-center rounded-full px-5 text-[14px] font-bold text-white active:opacity-70"
                style={{ background: t.blue }}
              >
                完成
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label="关闭并返回"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                style={{ color: t.text }}
              >
                {XIcons.back(22)}
              </button>
              <button
                type="button"
                disabled={!canPublish}
                onClick={publish}
                className="rounded-full px-5 h-[34px] text-[15px] font-bold text-white transition-opacity active:opacity-70 disabled:active:opacity-100"
                style={{
                  background: canPublish ? t.blue : t.dark ? 'rgba(29,155,240,0.45)' : '#a9d4f5',
                }}
                aria-label="发布"
              >
                发布
              </button>
            </>
          )}
        </div>

        {/* 正文区：头像（当前活跃账号：大号/匿名小号）+ 正文输入（全屏模式加大书写区） */}
        <div className={`flex gap-3 px-4 pt-3 ${full ? 'min-h-0 flex-1' : ''}`}>
          <XAvatar authorKey={activeAuthorKey()} size={40} />
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, LIMIT + 40))}
              placeholder="有什么新鲜事？"
              autoFocus={!full}
              className={`w-full flex-1 resize-none bg-transparent text-[20px] leading-[1.4] outline-none placeholder:text-[#9ca3af] ${full ? 'min-h-[45vh]' : 'min-h-[120px]'}`}
              style={{ color: t.text, caretColor: t.blue }}
              aria-label="帖子正文"
            />
          </div>
        </div>

        {/* 媒体预览（2 列网格 + 删除角标；全屏模式收起） */}
        {!full && media.length > 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-2">
            {media.map((m, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(137,151,166,0.35)' }}>
                <img src={m} alt={`附图 ${i + 1}`} className="h-full w-full object-cover" draggable={false} />
                <button
                  type="button"
                  aria-label={`移除附图 ${i + 1}`}
                  onClick={() => {
                    setMedia((cur) => cur.filter((_, j) => j !== i));
                    setMediaText((cur) => (cur.length === media.length ? cur.filter((_, j) => j !== i) : cur));
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white active:opacity-70"
                >
                  <X width={13} height={13} strokeWidth={3} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 投票编辑卡（开关激活时；全屏模式收起） */}
        {!full && pollOptions !== null && (
          <div className="mx-4 mt-2 shrink-0 rounded-2xl border p-3" style={{ borderColor: t.border }}>
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-bold">发起投票</p>
              <button
                type="button"
                onClick={() => setPollOptions(null)}
                className="text-[13px] font-medium active:opacity-60"
                style={{ color: t.secondary }}
              >
                移除投票
              </button>
            </div>
            <div className="mt-1 flex flex-col gap-2">
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) => setPollOptions((cur) => (cur ?? []).map((o, j) => (j === i ? e.target.value.slice(0, 25) : o)))}
                    placeholder={`选项 ${i + 1}`}
                    maxLength={25}
                    className="min-w-0 flex-1 rounded-full px-3 py-[7px] text-[15px] outline-none"
                    style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text, caretColor: t.blue }}
                    aria-label={`投票选项 ${i + 1}`}
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      aria-label={`删除选项 ${i + 1}`}
                      onClick={() => setPollOptions((cur) => (cur ?? []).filter((_, j) => j !== i))}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                      style={{ color: t.secondary }}
                    >
                      <X width={15} height={15} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {pollOptions.length < 4 ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((cur) => [...(cur ?? []), ''])}
                  className="text-[14px] font-bold active:opacity-60"
                  style={{ color: t.blue }}
                >
                  + 添加选项（{pollOptions.length}/4）
                </button>
              ) : (
                <span className="text-[13px]" style={{ color: t.secondary }}>
                  最多 4 个选项
                </span>
              )}
              <span className="text-[12px]" style={{ color: t.secondary }}>
                至少 2 个非空选项
              </span>
            </div>
          </div>
        )}

        {/* 工具行（相册/投票/表情/定时/位置/话题，灰色线条；相册含手机上传与文字搜图两种方式）+ 字数圆环
            （隐私行「所有人都可以回复」与「今日热议」版块胶囊已按用户要求删除；
            用户要求：所有界面禁止左右滑动——改换行铺开，不再横滑） */}
        <div
          className="forum-hide-scrollbar flex shrink-0 flex-wrap items-center gap-1 border-t px-3 py-1"
          style={{ borderColor: t.border }}
        >
          {/* 相册：弹层选择「手机相册上传」或「文字搜图」 */}
          {toolBtn(
            media.length > 0 ? `已添加 ${media.length} 张图片` : '添加图片',
            media.length > 0,
            <ImageIcon width={21} height={21} strokeWidth={SW} />,
            () => setSheet('gallery'),
          )}
          {toolBtn('发起投票', pollOptions !== null, <BarChart3 width={21} height={21} strokeWidth={SW} />, () => {
            if (pollOptions === null) setPollOptions(['', '']);
            else setPollOptions(null);
          })}
          {toolBtn('插入表情', sheet === 'emoji', <Smile width={21} height={21} strokeWidth={SW} />, () =>
            setSheet(sheet === 'emoji' ? null : 'emoji'),
          )}
          {toolBtn('定时发布', visibleAt !== null, <CalendarClock width={21} height={21} strokeWidth={SW} />, () => {
            setSheet(sheet === 'schedule' ? null : 'schedule');
          })}
          {toolBtn('添加位置', location !== null, <MapPin width={21} height={21} strokeWidth={SW} />, () => {
            setSheet(sheet === 'geo' ? null : 'geo');
            setGeoInput('');
          })}
          {toolBtn('插入话题', false, <Flag width={21} height={21} strokeWidth={SW} />, () => setSheet('topic'))}
          <span className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center">
            <Ring left={left} />
          </span>
        </div>

        {/* 底行：左下全屏写作方块（官方参考图）+ 定时/位置状态胶囊 */}
        {!full && (
          <div className="flex shrink-0 items-center gap-3 border-t px-4 pb-[20px] pt-2" style={{ borderColor: t.border }}>
            <button
              type="button"
              aria-label="全屏书写模式"
              onClick={() => setFull(true)}
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] transition-transform active:scale-95"
              style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text }}
            >
              <Maximize2 width={19} height={19} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {visibleAt !== null && (
                <button
                  type="button"
                  onClick={() => setSheet('schedule')}
                  className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold active:opacity-60"
                  style={{ background: 'rgba(0,186,124,0.14)', color: t.green }}
                >
                  <CalendarClock width={13} height={13} strokeWidth={2.2} aria-hidden="true" />
                  {fmtSchedule(visibleAt)} · 点击修改
                </button>
              )}
              {location !== null && (
                <button
                  type="button"
                  onClick={() => setSheet('geo')}
                  className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold active:opacity-60"
                  style={{ background: 'rgba(29,155,240,0.14)', color: t.blue }}
                >
                  <MapPin width={13} height={13} strokeWidth={2.2} aria-hidden="true" />
                  {location} · 点击修改
                </button>
              )}
              <span className="ml-auto text-[12px]" style={{ color: t.secondary }}>
                {media.length > 0 && `${media.length}/${MAX_MEDIA} 图`}
              </span>
            </div>
          </div>
        )}

        {/* 全屏模式的收起按钮（右下角悬浮） */}
        {full && (
          <div className="flex shrink-0 items-center justify-end px-4 pb-[24px]">
            <button
              type="button"
              aria-label="退出全屏"
              onClick={() => setFull(false)}
              className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-transform active:scale-95"
              style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text }}
            >
              <Minimize2 width={19} height={19} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* emoji / 定时 / 位置 / 话题 底部弹层（互斥，一次一个）;
          版块选择弹层已随隐私行一并移除（用户要求删除「今日热议」）；
          GIF·动图搜索已按用户要求删除（v9） */}
      {sheet && (
        <div className="absolute inset-0 z-10" role="dialog" aria-label="工具面板">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSheet(null)}
          />
          <div
            className="forum-hide-scrollbar absolute inset-x-0 bottom-0 max-h-[66%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto overflow-x-hidden rounded-t-2xl pb-[24px]"
            style={{ background: t.bg, color: t.text }}
          >
            {/* --- 相册选择（手机上传 / 文字图片） --- */}
            {sheet === 'gallery' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">添加图片</p>
                <p className="pb-3 text-[12px]" style={{ color: t.secondary }}>
                  从手机相册上传照片，或用文字图片 / AI 生图，最多 {MAX_MEDIA} 张
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSheet(null);
                    fileRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:opacity-60"
                  style={{ background: t.hover }}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'rgba(29,155,240,0.12)', color: t.blue }}
                    aria-hidden="true"
                  >
                    <ImageIcon width={20} height={20} strokeWidth={SW} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">手机相册上传</span>
                    <span className="block text-[12px]" style={{ color: t.secondary }}>
                      从手机相册选择照片上传
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTextImgInput('');
                    setSheet('textimg');
                  }}
                  className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:opacity-60"
                  style={{ background: t.hover }}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'rgba(123,79,224,0.12)', color: '#7b4fe0' }}
                    aria-hidden="true"
                  >
                    <Type width={20} height={20} strokeWidth={SW} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">文字图片 / AI 生图</span>
                    <span className="block text-[12px]" style={{ color: t.secondary }}>
                      白底居中文字图，或用生图模型按自定义提示词生成真图
                    </span>
                  </span>
                </button>
              </div>
            )}

            {/* --- 文字图片 / AI 生图（模式切换：白底文字图 or 生图模型真图） --- */}
            {sheet === 'textimg' && (
              <div className="px-4 pt-3">
                <div className="flex items-center justify-between gap-3 pb-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold">{imgMode === 'text' ? '文字图片' : 'AI 生图'}</p>
                    <p className="text-[12px]" style={{ color: t.secondary }}>
                      {imgMode === 'text' ? '用文字描述生成图片：纯白留白，文字居中排布' : '自定义提示词，用生图模型生成真实图片'}
                    </p>
                  </div>
                  {/* 模式切换胶囊 */}
                  <div
                    className="flex shrink-0 rounded-full p-[3px]"
                    style={{ background: t.dark ? '#202327' : '#eff3f4' }}
                    role="tablist"
                    aria-label="图片生成方式"
                  >
                    {([
                      { key: 'text', label: '文字图片', icon: <Type width={13} height={13} strokeWidth={2.2} /> },
                      { key: 'ai', label: 'AI 生图', icon: <Sparkles width={13} height={13} strokeWidth={2.2} /> },
                    ] as const).map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        role="tab"
                        aria-selected={imgMode === m.key}
                        onClick={() => setImgMode(m.key)}
                        className="flex items-center gap-1 rounded-full px-3 py-[6px] text-[12.5px] font-bold transition-all"
                        style={
                          imgMode === m.key
                            ? { background: t.blue, color: '#fff' }
                            : { color: t.secondary }
                        }
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {imgMode === 'text' ? (
                  <>
                    {/* 实时预览（与成品同布局；比例缩小的白底居中灰字卡。
                        v35：字号 13→22 匹配新渲染比例 46/720≈6.4%，行距同步 1.83） */}
                    <div
                      className="mb-3 flex aspect-square items-center justify-center rounded-xl border"
                      style={{ borderColor: t.border, background: '#ffffff' }}
                      aria-hidden="true"
                    >
                      <p className="px-6 break-all text-center" style={{ color: '#999997', fontSize: 22, lineHeight: 1.83 }}>
                        {textImgInput.trim() || '输入文字，生成你的文字图片'}
                      </p>
                    </div>
                    <textarea
                      value={textImgInput}
                      onChange={(e) => setTextImgInput(e.target.value.slice(0, TEXTIMG_MAX_LEN))}
                      rows={3}
                      placeholder="用一句文字描述图片，如 伦敦雨季很长，长到能忘记很多人和事。"
                      className="w-full resize-none rounded-xl px-3 py-[10px] text-[15px] outline-none"
                      style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text, caretColor: t.blue }}
                      aria-label="文字图片内容"
                    />
                    <div className="mt-3 flex items-center justify-between pb-1">
                      <span className="text-[12px]" style={{ color: t.secondary }}>
                        {textImgInput.length}/{TEXTIMG_MAX_LEN} 字，超出自动换行居中
                      </span>
                      <button
                        type="button"
                        disabled={!textImgInput.trim()}
                        onClick={() => {
                          try {
                            const url = renderTextImage(textImgInput);
                            addMedia([url], [textImgInput]);
                            setSheet(null);
                            setTextImgInput('');
                            f.toast('文字图片已生成，发布后可见；发布后点击卡片还能升级成真图');
                          } catch {
                            f.toast('生成失败，稍后再试');
                          }
                        }}
                        className="rounded-full px-5 py-2 text-[14px] font-bold text-white transition-opacity active:opacity-70 disabled:opacity-40"
                        style={{ background: t.blue }}
                      >
                        生成并添加
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 生图模型状态 */}
                    {(() => {
                      const cfg = useSettings.getState().imgGenConfig;
                      const ready = imgGenConfigReady(cfg);
                      return (
                        <div
                          className="mb-3 flex items-center gap-2.5 rounded-xl px-3 py-[10px]"
                          style={{ background: t.dark ? '#202327' : '#eff3f4' }}
                        >
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                            style={{
                              background: ready ? 'rgba(52,199,89,0.14)' : 'rgba(255,159,10,0.14)',
                              color: ready ? '#34c759' : '#ff9f0a',
                            }}
                            aria-hidden="true"
                          >
                            <Sparkles width={16} height={16} strokeWidth={2.1} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold leading-tight">
                              {ready ? cfg.model : '生图模型未配置'}
                            </p>
                            <p className="text-[11.5px] leading-tight" style={{ color: t.secondary }}>
                              {ready ? '已就绪 · 提示词会自动拼接全局补充词' : '在系统设置 › 图像生成里填好模型即可用'}
                            </p>
                          </div>
                          {!ready && (
                            <button
                              type="button"
                              onClick={gotoImgGenSettings}
                              className="shrink-0 rounded-full px-3 py-[6px] text-[12px] font-bold text-white"
                              style={{ background: t.blue }}
                            >
                              去设置
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    <textarea
                      value={aiImgPrompt}
                      onChange={(e) => setAiImgPrompt(e.target.value.slice(0, 400))}
                      rows={4}
                      placeholder="自定义提示词，描述想要的画面，如 黄昏的咖啡厅窗边，暖光落在木桌上，一杯拿铁冒着热气，窗外雨刚停"
                      className="w-full resize-none rounded-xl px-3 py-[10px] text-[15px] outline-none"
                      style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text, caretColor: t.blue }}
                      aria-label="AI 生图提示词"
                    />
                    <div className="mt-3 flex items-center justify-between pb-1">
                      <span className="text-[12px]" style={{ color: t.secondary }}>
                        {aiImgPrompt.length}/400 字 · 生成约需十几秒
                      </span>
                      <button
                        type="button"
                        disabled={!aiImgPrompt.trim() || aiImgBusy}
                        onClick={() => void genAiImage()}
                        className="flex items-center gap-1.5 rounded-full px-5 py-2 text-[14px] font-bold text-white transition-opacity active:opacity-70 disabled:opacity-40"
                        style={{ background: t.blue }}
                      >
                        {aiImgBusy ? (
                          <>
                            <Loader2 width={15} height={15} strokeWidth={2.2} className="animate-spin" aria-hidden="true" />
                            生成中…
                          </>
                        ) : (
                          '生成并添加'
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* --- emoji 面板 --- */}
            {sheet === 'emoji' && (
              <div className="px-4 pt-3">
                <p className="pb-2 text-[15px] font-bold">插入表情</p>
                <div className="grid grid-cols-8 gap-1 pb-2">
                  {EMOJI_SET.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmoji(e)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-[26px] transition-transform active:scale-90"
                      aria-label={`插入表情 ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* --- 定时发布 --- */}
            {sheet === 'schedule' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">定时发布</p>
                <p className="pb-2 text-[12px]" style={{ color: t.secondary }}>
                  到点后帖子自动出现在你的主页与时间线
                </p>
                {schedulePresets().map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setVisibleAt(p.at);
                      setSheet(null);
                      f.toast(`已定时 ${fmtSchedule(p.at)} 发布`);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <span className="text-[15px] font-bold">{p.label}</span>
                    <span className="text-[13px]" style={{ color: t.secondary }}>
                      {fmtSchedule(p.at)}
                    </span>
                  </button>
                ))}
                <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: t.hover }}>
                  <input
                    type="datetime-local"
                    value={customSchedule}
                    onChange={(e) => setCustomSchedule(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="自定义定时时间"
                  />
                  <button
                    type="button"
                    disabled={!customSchedule}
                    onClick={() => {
                      const at = new Date(customSchedule).getTime();
                      if (!Number.isFinite(at) || at <= Date.now()) {
                        f.toast('时间要选在将来');
                        return;
                      }
                      setVisibleAt(at);
                      setSheet(null);
                      f.toast(`已定时 ${fmtSchedule(at)} 发布`);
                    }}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    设为定时
                  </button>
                </div>
                {visibleAt !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleAt(null);
                      setSheet(null);
                      f.toast('已取消定时，改为立即发布');
                    }}
                    className="mt-2 w-full rounded-xl py-2.5 text-[14px] font-bold active:opacity-60"
                    style={{ background: 'rgba(244,33,46,0.1)', color: '#f4212e' }}
                  >
                    取消定时（改为立即发布）
                  </button>
                )}
              </div>
            )}

            {/* --- 位置 --- */}
            {sheet === 'geo' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">添加位置</p>
                <div className="mt-1 flex items-center gap-2 rounded-full px-3 py-2" style={{ background: t.dark ? '#202327' : '#eff3f4' }}>
                  <MapPin width={15} height={15} style={{ color: t.secondary }} aria-hidden="true" />
                  <input
                    value={geoInput}
                    onChange={(e) => setGeoInput(e.target.value.slice(0, 20))}
                    placeholder="输入地点，如 北京市·朝阳区"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="位置名称"
                  />
                  <button
                    type="button"
                    disabled={!geoInput.trim()}
                    onClick={() => {
                      setLocation(geoInput.trim());
                      setSheet(null);
                      f.toast(`已添加位置：${geoInput.trim()}`);
                    }}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    添加
                  </button>
                </div>
                <p className="mt-3 pb-1 text-[13px] font-bold" style={{ color: t.secondary }}>
                  快捷选择
                </p>
                {['北京市·朝阳区', '上海市·徐汇区', '广州市·天河区', '杭州市·西湖区', '成都市·锦江区'].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setLocation(name);
                      setSheet(null);
                      f.toast(`已添加位置：${name}`);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <MapPin width={15} height={15} style={{ color: t.blue }} aria-hidden="true" />
                    <span className="text-[15px]">{name}</span>
                  </button>
                ))}
                {location !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocation(null);
                      setSheet(null);
                      f.toast('已移除位置');
                    }}
                    className="mt-2 w-full rounded-xl py-2.5 text-[14px] font-bold active:opacity-60"
                    style={{ background: 'rgba(244,33,46,0.1)', color: '#f4212e' }}
                  >
                    移除当前位置
                  </button>
                )}
              </div>
            )}

            {/* --- 话题（旗子）：自定义输入 + 热门话题 --- */}
            {sheet === 'topic' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">插入话题标签</p>
                <p className="pb-2 text-[12px]" style={{ color: t.secondary }}>
                  输入自定义话题或点击热门话题，追加到正文末尾，正文里的 #话题# 会染成品牌蓝
                </p>
                {/* 自定义话题输入 */}
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-2"
                  style={{ background: t.dark ? '#202327' : '#eff3f4' }}
                >
                  <span className="text-[17px] font-bold" style={{ color: t.blue }} aria-hidden="true">
                    #
                  </span>
                  <input
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value.replace(/#/g, '').replace(/\s+/g, '').slice(0, 12))}
                    placeholder="自定义话题，如 周末去哪玩"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="自定义话题"
                  />
                  <button
                    type="button"
                    disabled={!customTopic.trim()}
                    onClick={() => {
                      appendTopic(customTopic.trim());
                      setCustomTopic('');
                    }}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    添加
                  </button>
                </div>
                <p className="pb-1 pt-4 text-[13px] font-bold" style={{ color: t.secondary }}>
                  热门话题
                </p>
                {trendingTopics(forumData()).map((tr) => (
                  <button
                    key={tr.tag}
                    type="button"
                    onClick={() => appendTopic(tr.tag)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <span className="text-[15px] font-bold" style={{ color: t.blue }}>
                      #{tr.tag}#
                    </span>
                    <span className="text-[13px]" style={{ color: t.secondary }}>
                      {tr.count} 条相关帖子
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 手机相册文件选择器（相册弹层「手机相册上传」触发） */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
