'use client';

/**
 * 缩字文本组件（两个变体，共享离屏探针测量与 ResizeObserver 跟随）
 * ---------------------------------------------------------------------------
 * ShrinkText 单行缩字——用户指定「字数超了的话，文字变小，不要让他弄第二行」：
 *  - 内容超宽时字号自动等比变小（下限 min），永不折行、不越出自身盒子；
 *  - 宽度由外层给定（本组件不设宽）：常见用法
 *      输入框占位文字：className 含 absolute inset-0 flex items-center + 左右内边距；
 *  - 文字宽度用「离屏探针」测量：与目标元素同字体参数、挂在 body（无祖先 transform）——
 *    直接 Range.getBoundingClientRect 会带祖先 transform（本机手机壳旋转 90°），
 *    量出的是视觉宽而非排版宽，与 clientWidth（排版空间）单位不一致会导致缩字失灵；
 *  - 字号按实测宽度等比换算，收敛阶段 0.1px 递减兜底；
 *    极端超长（缩到 min 仍放不下）整段溢出被 overflow-hidden 裁掉，绝不折行。
 *
 * StackFitText 堆叠缩字（头像下元信息专用，见文件下半区）：单行放不下时按
 * 空格/自然断点拆行堆叠、每行独立缩字，绝不裁字——修复长日期模板（yyyy/MM/dd HH:mm）
 * 在头像列（38/40px）内缩到下限仍放不下被裁「显示不全」的问题。
 *
 * 宽度变化（转屏/窗口缩放）经 ResizeObserver 跟随重算。
 */
import { useEffect, useRef, useState } from 'react';

export interface ShrinkTextProps {
  /** 要显示的文字（纯文本） */
  children: string;
  /** 追加类：需自带布局（block w-full / absolute inset-0 等）与颜色/字号基准 */
  className?: string;
  /** 最小字号（px；再放不下就整段裁掉，绝不折行） */
  min?: number;
  testId?: string;
  /** 对屏幕阅读器隐藏（纯装饰性叠层用，如输入框占位文字） */
  ariaHidden?: boolean;
}

export function ShrinkText({ children, className, min = 6, testId, ariaHidden }: ShrinkTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const text = children;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // 每次从头算：先清内联字号回类基准
      el.style.fontSize = '';
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      if (avail <= 0) return;
      const base = parseFloat(cs.fontSize) || 10;
      if (!(base > 0)) return;

      // 离屏探针：同字体参数挂在 body（无祖先 transform），量真实排版宽度
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:nowrap;visibility:hidden;';
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.style.fontSize = cs.fontSize;
      probe.textContent = el.textContent ?? '';
      document.body.appendChild(probe);
      try {
        let w = probe.getBoundingClientRect().width;
        if (w <= avail) return; // 放得下：保持基准字号

        // 等比换算一次到位（字号与字形宽度近似线性），0.1px 粒度向下取
        let size = Math.max(min, Math.min(base, (base * avail) / w));
        size = Math.floor(size * 10) / 10;

        // 收敛兜底：近似换算仍略超时按 0.1px 递减（换算与渲染有亚像素差）
        for (let guard = 48; guard > 0; guard--) {
          probe.style.fontSize = `${size}px`;
          el.style.fontSize = `${size}px`;
          if (probe.getBoundingClientRect().width <= avail) break;
          if (size <= min) break;
          size = Math.max(min, Math.floor((size - 0.1) * 10) / 10);
        }
      } finally {
        probe.remove();
      }
    };

    fit();
    // 宽度跟随：盒子尺寸变化（转屏/窗口缩放/父级布局变化）重算
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, min]);

  return (
    <span
      ref={ref}
      data-testid={testId}
      aria-hidden={ariaHidden || undefined}
      className={`overflow-hidden whitespace-nowrap ${className ?? ''}`}
    >
      {text}
    </span>
  );
}

// ================= StackFitText：堆叠缩字文本（头像下元信息专用） =================
//
// 背景（用户反馈）：时间模板 yyyy/MM/dd HH:mm（16 字符）选「头像下」位置时，
// ShrinkText 缩到 6px 下限仍 ~48px 宽 > 头像列 38/40px → overflow-hidden 裁字「显示不全」。
//
// 行为（在 ShrinkText「缩字不折行」之上增加自然断行，绝不裁字）：
//  1. 整段单行放得下（可缩字至 min）→ 单行（与 ShrinkText 完全一致）；
//  2. 放不下 → 按「空格」分段，每段独立成行、各自缩字——
//     「2026/10/29 18:07」天然拆成 日期 / 时间 上下两行（时间保持 10px，日期缩字）；
//  3. 某段缩到 min 仍放不下（如「2026年10月29日」无空格）→ 段内按 CJK 字符 /
//     常见分隔符（/ - : · . ，）边界深拆，贪心装箱：行数最少优先、字号最大次之；
//  4. 连单个原子块都放不下（超长无断点词）→ 该行按字符级换行兜底（min 字号）。
// 宽度由外层给定（className 含 block w-full，跟随头像列宽）；离屏探针测量同 ShrinkText
// （挂 body 无祖先 transform，手机壳旋转 90° 下量排版宽而非视觉宽）；ResizeObserver 跟随。

interface FitLine {
  /** 该行文字 */
  text: string;
  /** 字号（null = 继承类基准字号） */
  fontPx: number | null;
  /** 字符级兜底换行（超长无断点词的最后手段） */
  wrap: boolean;
}

/** 深拆分隔符：其后是自然断点（全半角各一份） */
const STACK_BREAK_AFTER = new Set(['/', '-', ':', '·', '.', ',', '、', '－', '：', '．', '，']);

/** CJK 判定（汉字 + CJK 标点 + 全角符号）：每个 CJK 字符后都是自然断点 */
function isCjkChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x30ff) || (c >= 0xff00 && c <= 0xffef);
}

/** 段内深拆成原子块：CJK 字符 / 分隔符之后断开（「2026年10月29日」→ 2026年 / 10月 / 29日） */
function chunkSegment(s: string): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const ch of s) {
    cur += ch;
    if (isCjkChar(ch) || STACK_BREAK_AFTER.has(ch)) {
      chunks.push(cur);
      cur = '';
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 两层布局是否一致（避免无谓 setState 触发渲染循环） */
function sameLines(a: FitLine[], b: FitLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].fontPx !== b[i].fontPx || a[i].wrap !== b[i].wrap) return false;
  }
  return true;
}

/** 布局核心（纯函数）：单行 → 空格分段 → 段内深拆装箱 → 字符级兜底 */
function computeStackLines(
  text: string,
  avail: number,
  base: number,
  min: number,
  measure: (s: string, px: number) => number,
): FitLine[] {
  /** 单行缩字：放得下返回最大可用字号（≤base、≥min、0.1px 粒度）；min 也放不下返回 null */
  const fitFont = (s: string): number | null => {
    const w = measure(s, base);
    if (w <= avail) return base;
    if (!(w > 0)) return base;
    let f = Math.max(min, Math.min(base, (base * avail) / w));
    f = Math.floor(f * 10) / 10;
    for (let guard = 64; guard > 0; guard--) {
      if (measure(s, f) <= avail) return f;
      if (f <= min) break;
      f = Math.max(min, Math.floor((f - 0.1) * 10) / 10);
    }
    return measure(s, min) <= avail ? min : null;
  };
  const line = (s: string, f: number | null): FitLine => ({ text: s, fontPx: f === base ? null : f, wrap: false });

  // 1) 整段单行（可缩字）
  const f1 = fitFont(text);
  if (f1 !== null) return [line(text, f1)];

  // 2) 按空格分段：每段独立成行、各自缩字（「日期 时间」格式天然上下两行）
  const segs = text.split(' ').filter(Boolean);
  if (segs.length > 1) {
    return segs.flatMap((seg) => {
      const f = fitFont(seg);
      return f !== null ? [line(seg, f)] : deepStackLines(seg, avail, base, min, measure);
    });
  }

  // 3/4) 无空格整段：深拆装箱 / 字符级兜底
  return deepStackLines(text, avail, base, min, measure);
}

/** 段内深拆贪心装箱：行数最少优先、字号最大次之；原子块过宽的行字符级换行兜底 */
function deepStackLines(
  seg: string,
  avail: number,
  base: number,
  min: number,
  measure: (s: string, px: number) => number,
): FitLine[] {
  const chunks = chunkSegment(seg);
  // 拆不出断点（超长无断点词）→ 字符级换行兜底，绝不裁字
  if (chunks.length <= 1) return [{ text: seg, fontPx: min, wrap: true }];

  /** 指定字号贪心装箱；返回各行（越界行必是单个过宽原子块，标记 wrap） */
  const packAt = (f: number): { lines: FitLine[]; overflow: boolean } => {
    const packed: string[] = [];
    let cur = '';
    for (const c of chunks) {
      if (!cur) {
        cur = c;
        continue;
      }
      if (measure(cur + c, f) <= avail) cur += c;
      else {
        packed.push(cur);
        cur = c;
      }
    }
    if (cur) packed.push(cur);
    let overflow = false;
    const lines = packed.map((s) => {
      const fits = measure(s, f) <= avail;
      if (!fits) overflow = true;
      return { text: s, fontPx: f === base ? null : f, wrap: !fits };
    });
    return { lines, overflow };
  };

  // 候选字号：base 整数档逐级降到 min（含两端；单行在 fitFont 已排除 → 最少 2 行）
  const cands: number[] = [];
  for (let f = Math.floor(base); f > min; f--) cands.push(f);
  cands.push(min);

  let best: { count: number; font: number; lines: FitLine[] } | null = null;
  for (const f of cands) {
    const { lines, overflow } = packAt(f);
    if (overflow) continue; // 该字号下有原子块过宽且无法再拆（wrap 行已标记，但优先找无溢出档位）
    if (!best || lines.length < best.count || (lines.length === best.count && f > best.font)) {
      best = { count: lines.length, font: f, lines };
    }
    if (best.count <= 2) break; // 已达理论最少行数
  }
  // 所有字号都有原子块过宽 → 取 min 档装箱（过宽行 wrap 兜底）
  if (!best) best = { count: Infinity, font: min, lines: packAt(min).lines };
  return best.lines;
}

export interface StackFitTextProps {
  /** 要显示的文字（纯文本；含空格时按空格分段堆叠） */
  children: string;
  /** 追加类：需自带布局（block w-full）与颜色/字号基准；勿含 whitespace-nowrap（兜底换行会被禁用） */
  className?: string;
  /** 最小字号（px；再放不下按空格/断点堆叠，绝不裁字） */
  min?: number;
  testId?: string;
  /** 对屏幕阅读器隐藏（纯装饰性叠层用） */
  ariaHidden?: boolean;
}

export function StackFitText({ children, className, min = 6, testId, ariaHidden }: StackFitTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const text = children;
  const [lines, setLines] = useState<FitLine[]>([{ text, fontPx: null, wrap: false }]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const layout = () => {
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      const base = parseFloat(cs.fontSize) || 10;
      if (!(avail > 0) || !(base > 0)) return;

      // 离屏探针（同 ShrinkText）：无祖先 transform，量真实排版宽
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:nowrap;visibility:hidden;';
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.letterSpacing = cs.letterSpacing;
      const measure = (s: string, px: number) => {
        probe.style.fontSize = `${px}px`;
        probe.textContent = s;
        return probe.getBoundingClientRect().width;
      };
      document.body.appendChild(probe);
      try {
        const next = computeStackLines(text, avail, base, min, measure);
        setLines((prev) => (sameLines(prev, next) ? prev : next));
      } finally {
        probe.remove();
      }
    };

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, min]);

  return (
    <span ref={ref} data-testid={testId} aria-hidden={ariaHidden || undefined} className={className}>
      {lines.map((l, i) => (
        <span
          key={`${i}:${l.text}`}
          className={l.wrap ? 'block' : 'block overflow-hidden whitespace-nowrap'}
          style={
            l.wrap
              ? { fontSize: l.fontPx ? `${l.fontPx}px` : undefined, overflowWrap: 'anywhere', wordBreak: 'break-all' }
              : l.fontPx
                ? { fontSize: `${l.fontPx}px` }
                : undefined
          }
        >
          {l.text}
        </span>
      ))}
    </span>
  );
}
