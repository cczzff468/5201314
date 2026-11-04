'use client';

import { Copy, ImageIcon, Loader2 } from 'lucide-react';
import { useState } from 'react';

/**
 * 「文字图片」卡片气泡（信息/微信/QQ 三端 + 朋友圈/QQ空间动态共用）：一张印着文字的纸面卡片。
 * 文字图片是「我」发给 TA 的卡片（AI 按人设+聊天记录代笔，或用户代写），点击可转成真图；
 * AI 动态配图降级时也用同款卡片（作者署名为角色）。
 * 视觉（韩系简约文具风）：象牙白平底 + 居中小字页眉 + 细短线 + 宋体正文（宽松行距）+ 细线署名，
 * 去掉旧版胶带/虚线相框的繁复装饰；深浅色模式各自成套；
 * variant 仅影响圆角与测试 ID（sms 大圆角 / qq 中圆角 / wx 小圆角）。
 */
export function TextCardBubble({
  text,
  signedBy,
  variant,
  onClick,
}: {
  /** 卡片正文（AI 代笔/用户代写；可含换行） */
  text: string;
  /** 右下署名（卡片以谁的身份发出） */
  signedBy: string;
  variant: 'sms' | 'wx' | 'qq';
  /** 点击卡片（弹出「生成图片/复制文字」操作面板；信息/微信/QQ 三端接线；朋友圈端为「生成真图」） */
  onClick?: () => void;
}) {
  const radius = variant === 'sms' ? 'rounded-[16px]' : variant === 'qq' ? 'rounded-[12px]' : 'rounded-[8px]';
  const inner =
    'chat-card chat-card-text chat-card-body relative w-[212px] select-none overflow-hidden border border-black/[0.05] bg-[#FBF9F3] shadow-[0_6px_20px_rgba(158,142,113,0.16),0_1px_3px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.985] dark:border-white/[0.08] dark:bg-[#2A282B] dark:shadow-[0_6px_20px_rgba(0,0,0,0.38)]';
  return onClick ? (
    <button
      type="button"
      data-testid={`textcard-bubble-${variant}`}
      aria-label={`文字图片卡片：${text.slice(0, 24)}`}
      onClick={onClick}
      className={`${radius} ${inner} block text-left`}
    >
      <CardFace text={text} signedBy={signedBy} />
    </button>
  ) : (
    <div data-testid={`textcard-bubble-${variant}`} className={`${radius} ${inner}`}>
      <CardFace text={text} signedBy={signedBy} />
    </div>
  );
}

/** 卡片面（正文 + 装饰）：带/不带点击的两种外壳共用 */
function CardFace({ text, signedBy }: { text: string; signedBy: string }) {
  return (
    <div className="px-[16px] pb-[12px] pt-[13px]">
      {/* 页眉：居中小字 + 短细线——韩系文具的极简抬头 */}
      <div className="flex flex-col items-center">
        <span className="text-[9px] font-medium tracking-[0.3em] text-[#B3A78F] dark:text-[#8F8778]">
          文字图片
        </span>
        <span
          aria-hidden="true"
          className="mt-[7px] h-px w-[26px] rounded-full bg-[#DDD4C4] dark:bg-white/[0.12]"
        />
      </div>
      {/* 正文：宋体、宽松行距，留白呼吸感 */}
      <p className="mt-[10px] whitespace-pre-wrap break-words font-serif text-[14px] leading-[1.9] tracking-[0.02em] text-[#6B6355] dark:text-[#D3CCBE]">
        {text}
      </p>
      {/* 署名：右对齐，名字前一段小细线（同页眉线条呼应） */}
      <p className="mt-[8px] flex items-center justify-end gap-[6px] font-serif text-[11px] tracking-[0.05em] text-[#B3A78F] dark:text-[#8F8778]">
        <span aria-hidden="true" className="inline-block h-px w-[14px] bg-[#DDD4C4] dark:bg-white/[0.14]" />
        {signedBy}
      </p>
    </div>
  );
}

/**
 * 「文字图片」卡片操作面板（信息/微信/QQ 点击卡片弹出，共用）：
 * 顶部「文字图片」标签 + 可编辑画面描述（预填卡片文字，生成前可改）
 * + 「用图像生成生成图片」（走 设置 › 图像生成 的配置；busy 转圈；成功后卡片原位变图片，不发给 AI）
 * + 「复制文字」（复制卡片原文，内部处理剪贴板与降级，结果经 onToast 反馈）。
 */
export function TextCardActionSheet({
  text,
  busy,
  accent,
  onGenerate,
  onToast,
  onClose,
}: {
  /** 卡片文字（描述输入框预填 + 复制内容） */
  text: string;
  /** 正在生成图片（生成行转圈，面板不可关闭） */
  busy: boolean;
  /** 各端主题色（信息 #007AFF / 微信 #07C160 / QQ #0099FF） */
  accent: string;
  /** 生成图片（desc = 可编辑后的画面描述；成功后图片原位替换卡片） */
  onGenerate: (desc: string) => void;
  onToast: (m: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  /** 画面描述（预填卡片文字，生成前可修改） */
  const [desc, setDesc] = useState(text);
  /** 复制卡片文字：clipboard API 失败（非安全上下文等）降级 execCommand */
  const doCopy = async () => {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast('已复制卡片文字');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        onToast('已复制卡片文字');
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        onToast('复制失败，请长按卡片文字手动复制');
      }
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-3 pb-[max(14px,env(safe-area-inset-bottom))]" data-testid="textcard-actions-sheet">
      <div className="w-full max-w-[340px]">
        <div className="overflow-hidden rounded-[14px] bg-white/95 pb-1 backdrop-blur-xl dark:bg-[#252528]/95">
          {/* 描述编辑头：卡片文字预填进输入框，生成前可改（宋体呼应卡片面） */}
          <div className="border-b border-black/[0.06] px-4 pb-2.5 pt-3 dark:border-white/[0.08]">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] tracking-[0.08em] text-black/40 dark:text-white/40">文字图片</p>
              <p className="text-[10.5px] text-black/35 dark:text-white/35">生成的图片将替换这张卡片</p>
            </div>
            <textarea
              data-testid="textcard-desc-input"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={200}
              disabled={busy}
              placeholder="描述想要的画面（场景/动作/表情/氛围）"
              className="mt-2 w-full resize-none rounded-[10px] border border-black/[0.10] bg-black/[0.03] px-3 py-2 font-serif text-[13.5px] leading-[1.7] text-black/80 outline-none placeholder:text-black/30 focus:border-black/25 disabled:opacity-60 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white/85 dark:placeholder:text-white/30 dark:focus:border-white/30"
            />
          </div>
          <button
            type="button"
            data-testid="textcard-gen"
            onClick={() => onGenerate(desc)}
            disabled={busy || !desc.trim()}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 text-[16px] font-medium active:bg-black/[0.05] disabled:opacity-60 dark:active:bg-white/[0.06]"
            style={{ color: accent }}
          >
            {busy ? (
              <>
                <Loader2 className="h-[17px] w-[17px] animate-spin" strokeWidth={2.4} aria-hidden="true" />
                正在生成图片…
              </>
            ) : (
              <>
                <ImageIcon className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
                用图像生成生成图片
              </>
            )}
          </button>
          <div className="mx-4 h-px bg-black/[0.05] dark:bg-white/[0.07]" />
          <button
            type="button"
            data-testid="textcard-copy"
            onClick={() => void doCopy()}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 text-[16px] font-medium text-black/80 active:bg-black/[0.05] dark:text-white/80 dark:active:bg-white/[0.06]"
          >
            <Copy className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
            {copied ? '已复制' : '复制文字'}
          </button>
        </div>
        <button
          type="button"
          data-testid="textcard-cancel"
          onClick={onClose}
          disabled={busy}
          className="mt-2 flex min-h-[50px] w-full items-center justify-center rounded-[14px] bg-white/95 text-[16px] font-semibold text-black/80 backdrop-blur-xl active:bg-black/[0.05] disabled:opacity-60 dark:bg-[#252528]/95 dark:text-white/80 dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}
