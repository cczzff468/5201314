'use client';

import { useRef, useState } from 'react';
import { kvGet } from '@/lib/ios/idb-kv';
import { Airplay, FastForward, Pause, Rewind, Star } from 'lucide-react';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { fileToScaledDataURL } from './ProfileCard';

/**
 * 一起听小组件（第三页 2×3 方格）：仿「一起听歌」邀请卡（用户参考图样式）——
 * 双头像各自头顶聊天气泡（可改字），耳机线从两侧耳塞沿头像外侧向下汇聚、
 * 插入下方迷你播放器（歌名/歌词/进度条/时间/控制键），中间一行「相距/一起听」文案。
 * 整体无边框无卡片底无投影：白色气泡与浅灰播放器直接浮在壁纸上。
 * 头像/气泡/歌名/歌词/状态文案均可在编辑器里修改；数据经 idb-kv 写穿 IndexedDB（本地持久化）。
 */

/** 一起听小组件数据 */
export interface ListenCardData {
  /** 左头像头顶气泡的文字 */
  bubbleLeft: string;
  /** 右头像头顶气泡的文字 */
  bubbleRight: string;
  /** 左头像 dataURL；null = 内置默认图 */
  avatar1: string | null;
  /** 右头像 dataURL；null = 内置默认图 */
  avatar2: string | null;
  /** 歌名（播放器第一行） */
  songTitle: string;
  /** 歌词/副标题（播放器第二行） */
  songLyric: string;
  /** 中部状态文案（相距/一起听时长） */
  status: string;
  /** 已播秒数（进度条位置 + 左侧时间） */
  elapsed: number;
  /** 总时长秒数（右侧显示 -剩余） */
  total: number;
}

export const LISTEN_CARD_KEY = 'home.listenCard.v2';
/** 左头像默认图：用户指定的「该用户很安详」猫咪 */
export const LISTEN_AVATAR_LEFT = '/images/couple-cat-peace.png';
/** 右头像默认图：用户指定的「该用户长得太萌无法查看」猫咪 */
export const LISTEN_AVATAR_RIGHT = '/images/couple-cat-cute.png';

/** 默认内容（用户指定：双气泡均「我想你了」，歌名 想你时风起，歌词 如果离别 是为了 能再见一面） */
export const DEFAULT_LISTEN_CARD: ListenCardData = {
  bubbleLeft: '我想你了',
  bubbleRight: '我想你了',
  avatar1: null,
  avatar2: null,
  songTitle: '想你时风起',
  songLyric: '如果离别 是为了 能再见一面',
  status: '相距13.14公里,一起听了520小时14分钟',
  elapsed: 40,
  total: 282,
};

/** 读取持久化的一起听数据（损坏/缺失时回退默认值） */
export function loadListenCard(): ListenCardData {
  try {
    const p = kvGet<Partial<ListenCardData>>(LISTEN_CARD_KEY);
    if (!p) return DEFAULT_LISTEN_CARD;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
    return {
      bubbleLeft: str(p.bubbleLeft, DEFAULT_LISTEN_CARD.bubbleLeft),
      bubbleRight: str(p.bubbleRight, DEFAULT_LISTEN_CARD.bubbleRight),
      avatar1: typeof p.avatar1 === 'string' ? p.avatar1 : null,
      avatar2: typeof p.avatar2 === 'string' ? p.avatar2 : null,
      songTitle: str(p.songTitle, DEFAULT_LISTEN_CARD.songTitle),
      songLyric: str(p.songLyric, DEFAULT_LISTEN_CARD.songLyric),
      status: str(p.status, DEFAULT_LISTEN_CARD.status),
      elapsed: num(p.elapsed, DEFAULT_LISTEN_CARD.elapsed),
      total: num(p.total, DEFAULT_LISTEN_CARD.total),
    };
  } catch {
    return DEFAULT_LISTEN_CARD;
  }
}

/** 秒 → m:ss（进度条两侧时间） */
const fmtTime = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/** 单个「气泡 + 头像」列：气泡自动高度（最多两行），头像固定位置保证耳机线对准 */
function BubbleHead({ text, avatar, alt }: { text: string; avatar: string; alt: string }) {
  return (
    <div className="relative h-[92px] w-[68px]">
      {/* 气泡（顶部 + 底部小尾巴指向下方头像） */}
      <div className="absolute inset-x-0 top-0 z-[1] flex justify-center">
        <div className="relative w-fit max-w-full">
          <div className="rounded-[11px] bg-white px-[8px] py-[5px] text-center ring-1 ring-black/[0.07]">
            {text ? (
              <p className="line-clamp-2 break-all text-[10px] font-semibold leading-[13px] text-[#161618]">{text}</p>
            ) : (
              <p className="text-[10px] leading-[13px] text-black/30">说点什么…</p>
            )}
          </div>
          <span
            aria-hidden="true"
            className="absolute -bottom-[3px] left-1/2 h-[7px] w-[7px] -translate-x-1/2 rotate-45 rounded-[2px] bg-white"
          />
        </div>
      </div>
      {/* 头像（固定 top：耳机线/耳塞按此几何定位） */}
      <img
        src={avatar}
        alt={alt}
        draggable={false}
        className="absolute left-1/2 top-[40px] z-[1] h-[46px] w-[46px] -translate-x-1/2 select-none rounded-full object-cover ring-2 ring-white/90"
      />
    </div>
  );
}

/** 卡片可视内容（2×3 方格槽位 ≈167×260 满格）：双头像+气泡 / 状态文案 / 迷你播放器，
 *  耳机线用一张绝对定位 SVG 画出（viewBox 167×260，preserveAspectRatio=none 随槽位缩放）；
 *  线色随主题自适应（深色壁纸上白线、浅色模式黑线），保证清晰可见。 */
export function ListenCardWidget({ data }: { data: ListenCardData }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  const wireColor = dark ? 'rgba(255,255,255,0.9)' : '#1c1c1e';
  const pct = data.total > 0 ? Math.max(0, Math.min(100, Math.round((data.elapsed / data.total) * 100))) : 0;
  return (
    <div className="relative h-[260px] w-full select-none">
      {/* 耳机线：两侧耳塞 → 沿头像外侧向下汇聚 → 竖线插入播放器顶部 */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 167 260"
        preserveAspectRatio="none"
        fill="none"
      >
        <path d="M17 64 C 14 104, 48 128, 83.5 140" stroke={wireColor} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d="M150 64 C 153 104, 119 128, 83.5 140" stroke={wireColor} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d="M83.5 140 L 83.5 196" stroke={wireColor} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx="17" cy="64" r="3.4" fill={wireColor} />
        <circle cx="150" cy="64" r="3.4" fill={wireColor} />
      </svg>

      {/* 双头像 + 头顶气泡 */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-center gap-[12px]">
        <BubbleHead text={data.bubbleLeft} avatar={data.avatar1 || LISTEN_AVATAR_LEFT} alt="左头像" />
        <BubbleHead text={data.bubbleRight} avatar={data.avatar2 || LISTEN_AVATAR_RIGHT} alt="右头像" />
      </div>

      {/* 相距/一起听时长文案（线框包裹，用户要求「添加一个线包裹着」；深浅主题自适应） */}
      <p
        className={`absolute inset-x-0 top-[112px] flex justify-center px-1 text-center text-[7px] leading-[10px] tracking-tight ${
          dark ? 'text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]' : 'text-[#3a3a3e]'
        }`}
      >
        <span
          className={`inline-block max-w-full truncate rounded-full border px-[8px] py-[2.5px] ${
            dark ? 'border-white/45 bg-white/[0.10]' : 'border-[#3a3a3e]/40 bg-white/40'
          }`}
        >
          {data.status}
        </span>
      </p>

      {/* 迷你播放器（卡体深浅主题自适应：深色炭黑卡白字、浅色浅灰卡黑字） */}
      <div
        className={`absolute inset-x-[3px] bottom-[2px] rounded-[13px] px-[9px] pb-[6px] pt-[7px] ${
          dark ? 'bg-[#26262b] text-white ring-1 ring-white/10' : 'bg-[#f3f3f5] text-[#161618]'
        }`}
      >
        <p className="truncate text-center text-[9px] font-bold leading-[12px]">{data.songTitle}</p>
        <p className={`mt-[1px] truncate text-center text-[7px] leading-[9px] ${dark ? 'text-white/50' : 'text-black/45'}`}>
          {data.songLyric}
        </p>
        {/* 进度条 + 时间 */}
        <div className="mt-[5px] flex items-center gap-[4px]">
          <span className={`text-[6.5px] leading-none tabular-nums ${dark ? 'text-white/70' : 'text-black/70'}`}>{fmtTime(data.elapsed)}</span>
          <span className={`relative h-[3px] flex-1 overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-black/15'}`}>
            <span className={`absolute inset-y-0 left-0 rounded-full ${dark ? 'bg-white' : 'bg-[#161618]'}`} style={{ width: `${pct}%` }} />
          </span>
          <span className={`text-[6.5px] leading-none tabular-nums ${dark ? 'text-white/70' : 'text-black/70'}`}>-{fmtTime(data.total - data.elapsed)}</span>
        </div>
        {/* 控制键（装饰，复刻参考图：喜欢/上一首/播放/下一首/投播） */}
        <div className={`mt-[5px] flex items-center justify-between px-[3px] ${dark ? 'text-[#eaeaec]' : 'text-[#1c1c1e]'}`}>
          <Star className="h-[9px] w-[9px]" strokeWidth={2.4} aria-hidden="true" />
          <Rewind className="h-[10px] w-[10px]" strokeWidth={2.4} aria-hidden="true" />
          <Pause className="h-[12px] w-[12px]" strokeWidth={2.6} aria-hidden="true" />
          <FastForward className="h-[10px] w-[10px]" strokeWidth={2.4} aria-hidden="true" />
          <Airplay className="h-[9px] w-[9px]" strokeWidth={2.2} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-[10px] bg-white/10 px-3 py-[8px] text-[14px] text-white outline-none ring-1 ring-white/10 transition-colors placeholder:text-white/35 focus:bg-white/15 focus:ring-white/20';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-[6px] block text-[12px] font-medium text-white/55">{label}</span>
      {children}
    </label>
  );
}

/** 编辑器（主屏根层级底部弹窗）：换双头像 / 改气泡 / 改歌名/歌词/状态文案，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），草稿用当前数据初始化。 */
export function ListenCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: ListenCardData;
  onClose: () => void;
  onSave: (d: ListenCardData) => void;
}) {
  const [draft, setDraft] = useState<ListenCardData>(data);
  const avatar1Input = useRef<HTMLInputElement | null>(null);
  const avatar2Input = useRef<HTMLInputElement | null>(null);
  /** 选图守卫：开选图器后 1.5s 内忽略遮罩点击（防合成/幽灵 click 误关弹窗） */
  const pickGuardUntil = useRef(0);

  const pick = (which: 1 | 2) => {
    pickGuardUntil.current = Date.now() + 1500;
    (which === 1 ? avatar1Input : avatar2Input).current?.click();
  };

  const onFile = (which: 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileToScaledDataURL(file, 256, 0.85)
        .then((u) => setDraft((d) => (which === 1 ? { ...d, avatar1: u } : { ...d, avatar2: u })))
        .catch(() => undefined);
    }
    e.target.value = '';
  };

  const save = () => {
    const clean = (s: string) => s.trim();
    onSave({
      ...draft,
      bubbleLeft: clean(draft.bubbleLeft),
      bubbleRight: clean(draft.bubbleRight),
      songTitle: clean(draft.songTitle) || DEFAULT_LISTEN_CARD.songTitle,
      songLyric: clean(draft.songLyric) || DEFAULT_LISTEN_CARD.songLyric,
      status: clean(draft.status) || DEFAULT_LISTEN_CARD.status,
    });
  };

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑一起听"
      className="absolute inset-0 z-[70] flex flex-col bg-black/55 backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (Date.now() < pickGuardUntil.current) return;
        onClose();
      }}
    >
      <div className="mt-auto px-2 pb-3" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-[24px] bg-[#1d1d1f]/95 p-4 text-white shadow-[0_-8px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
          {/* 顶栏 */}
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={onClose} className="text-[15px] text-white/65 transition-opacity active:opacity-50">
              取消
            </button>
            <p className="text-[15px] font-semibold">编辑一起听</p>
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-white px-4 py-[5px] text-[14px] font-semibold text-black transition-transform active:scale-95"
            >
              保存
            </button>
          </div>

          <div className="no-scrollbar max-h-[46vh] space-y-4 overflow-y-auto pr-0.5">
            {/* 左右头像（可更换） */}
            <div className="flex items-center gap-3">
              <img
                src={draft.avatar1 || LISTEN_AVATAR_LEFT}
                alt="左头像预览"
                className="h-[48px] w-[48px] shrink-0 rounded-full object-cover ring-1 ring-white/15"
              />
              <div className="flex flex-col items-start gap-[6px]">
                <span className="text-[12px] font-medium text-white/55">左边头像</span>
                <div className="flex items-center gap-[10px]">
                  <button
                    type="button"
                    onClick={() => pick(1)}
                    className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
                  >
                    更换头像
                  </button>
                  {draft.avatar1 && (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, avatar1: null }))}
                      className="text-[11px] text-white/50 transition-colors active:text-white/80"
                    >
                      恢复默认
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <img
                src={draft.avatar2 || LISTEN_AVATAR_RIGHT}
                alt="右头像预览"
                className="h-[48px] w-[48px] shrink-0 rounded-full object-cover ring-1 ring-white/15"
              />
              <div className="flex flex-col items-start gap-[6px]">
                <span className="text-[12px] font-medium text-white/55">右边头像</span>
                <div className="flex items-center gap-[10px]">
                  <button
                    type="button"
                    onClick={() => pick(2)}
                    className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
                  >
                    更换头像
                  </button>
                  {draft.avatar2 && (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, avatar2: null }))}
                      className="text-[11px] text-white/50 transition-colors active:text-white/80"
                    >
                      恢复默认
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Field label="左边气泡">
              <input
                value={draft.bubbleLeft}
                maxLength={12}
                onChange={(e) => setDraft((d) => ({ ...d, bubbleLeft: e.target.value }))}
                className={inputCls}
                placeholder="我想你了"
              />
            </Field>
            <Field label="右边气泡">
              <input
                value={draft.bubbleRight}
                maxLength={12}
                onChange={(e) => setDraft((d) => ({ ...d, bubbleRight: e.target.value }))}
                className={inputCls}
                placeholder="我想你了"
              />
            </Field>
            <Field label="歌名">
              <input
                value={draft.songTitle}
                maxLength={24}
                onChange={(e) => setDraft((d) => ({ ...d, songTitle: e.target.value }))}
                className={inputCls}
                placeholder="想你时风起"
              />
            </Field>
            <Field label="歌词">
              <input
                value={draft.songLyric}
                maxLength={30}
                onChange={(e) => setDraft((d) => ({ ...d, songLyric: e.target.value }))}
                className={inputCls}
                placeholder="如果离别 是为了 能再见一面"
              />
            </Field>
            <Field label="状态文案">
              <input
                value={draft.status}
                maxLength={30}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                className={inputCls}
                placeholder="相距13.14公里,一起听了520小时14分钟"
              />
            </Field>
          </div>
        </div>

        {/* 隐藏文件选择器（放在底部弹层内部：合成 click 只冒泡到已 stopPropagation 的弹层） */}
        <input ref={avatar1Input} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(1)} />
        <input ref={avatar2Input} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={onFile(2)} />
      </div>
    </div>
  );
}
