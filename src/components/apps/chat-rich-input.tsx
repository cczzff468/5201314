'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { splitEmojiCodes, type EmojiCodeApp } from '@/lib/ios/emoji-codes';
import { ShrinkText } from './shrink-text';

/**
 * 聊天富文本输入框（contentEditable，微信 / QQ / 群聊四端共用）：
 * - 替代纯文本 textarea：内置表情以真实表情小图（<img data-code>）内联显示，不再显示 [微笑] 文字代码
 *   （对照真机微信/QQ：表情进输入框即可见图，可删可混排，Backspace 一键删整枚）
 * - 对外仍是纯文本协议：输入时把 DOM 序列化回文字代码（[微笑]）上报 onChange，
 *   消息存储 / AI 上下文 / 气泡渲染链路零改动
 * - 同步策略：内部序列化值与外部 value 一致时绝不重写 DOM——保护光标位置与中文输入法合成过程；
 *   只在真正外部变更（发送清空 / 切换会话草稿 / @ 替换注入）时重建内容
 * - 插入表情：ref.insertEmoji(name,url) 光标处插入（无焦点追加末尾，与旧 textarea 行为一致），
 *   不抢焦点——真机点表情不弹键盘、面板保持展开可连点
 */

/** 输入框内联表情图样式（22px 与气泡混排同款，基线微调对齐文字） */
const RICH_EMOJI_CLS = 'mx-[1px] inline-block h-[22px] w-[22px] select-none align-[-5px] object-contain';

function makeEmojiImg(name: string, url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.setAttribute('data-code', name);
  img.alt = name;
  img.draggable = false;
  img.className = RICH_EMOJI_CLS;
  return img;
}

/** value（含 [微笑] 代码的纯文本）→ DOM：代码转表情图，\n 转 <br>（纯 DOM API 构建，防注入） */
function renderRichValue(el: HTMLElement, app: EmojiCodeApp, value: string): void {
  const hadFocus = document.activeElement === el;
  el.textContent = '';
  const frag = document.createDocumentFragment();
  for (const part of splitEmojiCodes(app, value)) {
    if (part.type === 'emoji' && part.url) {
      frag.appendChild(makeEmojiImg(part.name ?? '', part.url));
    } else {
      const segs = (part.text ?? '').split('\n');
      segs.forEach((s, i) => {
        if (i > 0) frag.appendChild(document.createElement('br'));
        if (s) frag.appendChild(document.createTextNode(s));
      });
    }
  }
  el.appendChild(frag);
  if (hadFocus) {
    // 外部文本注入（@ 替换、草稿切换）时光标落到末尾，继续键入位置正确
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

/** DOM → value：img[data-code] → [名字]、<br> → \n、文本原样；块级容器边界补换行（浏览器 Enter 兜底结构） */
function serializeRichInput(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'IMG') {
      const code = el.getAttribute('data-code');
      if (code) out += `[${code}]`;
      return;
    }
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      if (out && !out.endsWith('\n')) out += '\n';
    }
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

export interface ChatRichInputHandle {
  /** 当前输入框 DOM（特殊场景直取） */
  el: () => HTMLDivElement | null;
  /** 在光标处插入内置表情图（无焦点时追加末尾；不抢焦点，面板可连点） */
  insertEmoji: (name: string, url: string) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface ChatRichInputProps {
  app: EmojiCodeApp;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
  /** placeholder 叠层的布局/颜色类（需自带左右内边距与对齐，如 "absolute inset-0 flex items-center pl-3.5 pr-11 text-[16px] text-black/30 dark:text-white/30"；
   *  垂直自动居中；超长时字号自动变小，永不折行（ShrinkText） */
  placeholderClass?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
  enterKeyHint?: 'send' | 'enter';
}

export const ChatRichInput = forwardRef<ChatRichInputHandle, ChatRichInputProps>(function ChatRichInput(
  { app, value, onChange, onKeyDown, placeholder, placeholderClass, ariaLabel, testId, className, enterKeyHint },
  ref
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  // 最近一次上报的序列化值（哨兵初值保证首挂必渲染一次）
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (value === lastSyncedRef.current) return; // 内部输入驱动的更新：DOM 已是最新，绝不重写（保护光标/IME）
    lastSyncedRef.current = value;
    renderRichValue(el, app, value);
  }, [app, value]);

  /** DOM 序列化上报；全空白时规范为空串并清掉残留 <br>，保证 placeholder 正确出现 */
  const emitFromDom = (): void => {
    const el = elRef.current;
    if (!el) return;
    let text = serializeRichInput(el);
    if (!text.trim()) {
      text = '';
      renderRichValue(el, app, '');
    }
    lastSyncedRef.current = text;
    onChange(text);
  };

  useImperativeHandle(ref, () => ({
    el: () => elRef.current,
    insertEmoji: (name: string, url: string) => {
      const el = elRef.current;
      if (!el) return;
      if (!value.trim()) renderRichValue(el, app, ''); // 空框先清残留 <br>，防消息带出首行换行
      const img = makeEmojiImg(name, url);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // 无焦点（点面板连选）：追加末尾，不抢焦点
        el.appendChild(img);
      }
      emitFromDom();
    },
    focus: () => elRef.current?.focus(),
  }));

  return (
    <div className="relative">
      <div
        ref={elRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        data-testid={testId}
        enterKeyHint={enterKeyHint}
        onInput={emitFromDom}
        onKeyDown={(e) => {
          onKeyDown?.(e); // 外部先处理（回车发送开关可能拦截发送）
          if (e.defaultPrevented) return;
          // 关闭回车发送时：Enter 统一插 <br>（序列化可靠），不依赖浏览器默认的分段结构
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            document.execCommand('insertLineBreak');
          }
        }}
        onPaste={(e) => {
          // 只允许纯文本进框（逐行 insertLineBreak 保住换行），杜绝富 HTML 污染结构
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          if (!text) return;
          const segs = text.split('\n');
          segs.forEach((s, i) => {
            if (i > 0) document.execCommand('insertLineBreak');
            if (s) document.execCommand('insertText', false, s);
          });
        }}
        onDrop={(e) => e.preventDefault()} // 禁拖放富文本进框（结构只经代码路径维护）
        className={className}
      />
      {!value && placeholder ? (
        /* 占位灰字（ShrinkText）：布局/内边距/颜色由 placeholderClass 提供
           （absolute inset-0 flex items-center + pl/pr/字号/颜色）；垂直居中；
           字数超出时字号自动变小，永不折第二行、不压右侧按钮 */
        <ShrinkText
          ariaHidden
          min={6}
          className={`pointer-events-none ${placeholderClass ?? ''}`}
        >
          {placeholder}
        </ShrinkText>
      ) : null}
    </div>
  );
});
