'use client';

import { useEffect, useReducer, useState } from 'react';
import { BackToHome } from '@/components/ios/BackToHome';

/* ==================== 数字格式化 ==================== */

function numToString(v: number): string {
  if (!Number.isFinite(v)) return '错误';
  const r = Math.round(v * 1e10) / 1e10;
  if (r === 0) return '0';
  const abs = Math.abs(r);
  if (abs >= 1e15 || abs < 1e-9) return r.toExponential(5);
  if (Number.isInteger(r)) return String(r);
  const s = String(parseFloat(r.toPrecision(12)));
  const digits = s.replace(/[^0-9]/g, '').length;
  return digits > 15 ? r.toExponential(5) : s;
}

const toDisplay = (s: string) => s.replace(/-/g, '−');
const fmt = (v: number) => toDisplay(numToString(v));

/* ==================== 竖屏顺序计算（仿 iOS） ==================== */

type OpSym = '+' | '−' | '×' | '÷';

interface PState {
  disp: string;
  hist: string;
  pendOp: OpSym | null;
  pendVal: number | null;
  typing: boolean;
  lastOp: { op: OpSym; val: number } | null;
  err: boolean;
  // #23: 运算符挂起中按 +/- 后，下一数字/点/等号应作负数处理
  pendingNeg?: boolean;
}

const P_INIT: PState = { disp: '0', hist: '', pendOp: null, pendVal: null, typing: false, lastOp: null, err: false, pendingNeg: false };
const P_ERR: PState = { ...P_INIT, disp: '错误', err: true };

function pCompute(a: number, b: number, op: OpSym): number | null {
  let r = NaN;
  if (op === '+') r = a + b;
  else if (op === '−') r = a - b;
  else if (op === '×') r = a * b;
  else if (op === '÷') r = b === 0 ? NaN : a / b;
  return Number.isFinite(r) ? Math.round(r * 1e10) / 1e10 : null;
}

type PAction =
  | { t: 'digit'; d: string }
  | { t: 'dot' }
  | { t: 'op'; op: OpSym }
  | { t: 'eq' }
  | { t: 'clear' }
  | { t: 'neg' }
  | { t: 'pct' };

function portraitReducer(s: PState, a: PAction): PState {
  switch (a.t) {
    case 'digit': {
      const base = s.err ? P_INIT : s;
      // #23: pendingNeg 时新操作数前缀负号
      if (!base.typing) return { ...base, disp: base.pendingNeg ? `-${a.d}` : a.d, typing: true, pendingNeg: false };
      if (base.disp.length >= 9) return base;
      if (base.disp === '0') return { ...base, disp: a.d === '0' ? '0' : a.d };
      return { ...base, disp: base.disp + a.d };
    }
    case 'dot': {
      const base = s.err ? P_INIT : s;
      // #23: pendingNeg 时小数点前缀负号
      if (!base.typing) return { ...base, disp: base.pendingNeg ? '-0.' : '0.', typing: true, pendingNeg: false };
      if (base.disp.includes('.') || base.disp.length >= 9) return base;
      return { ...base, disp: `${base.disp}.` };
    }
    case 'neg': {
      if (s.err) return s;
      if (s.typing) {
        if (s.disp === '0') return s;
        return s.disp.startsWith('-') ? { ...s, disp: s.disp.slice(1) } : { ...s, disp: `-${s.disp}` };
      }
      // #23: typing=false 时，若运算符挂起中（正在输入第二操作数），标记下一数字为负而非翻转当前显示
      if (s.pendOp !== null && s.pendVal !== null) {
        return { ...s, pendingNeg: !s.pendingNeg };
      }
      // 无挂起运算符（第一操作数/等号后）：直接取反当前显示值
      const v = Number(s.disp);
      if (v === 0) return s;
      return { ...s, disp: numToString(-v) };
    }
    case 'pct': {
      if (s.err) return s;
      // iOS 语义：+/− 挂起时按前一操作数的百分比换算（200 + 10% = 200 + 200×10% = 220，
      // 200 − 10% = 180）；×/÷ 或无挂起运算时 % 即 /100（50 × 10% = 50 × 0.1 = 5）
      // #23: pendingNeg 时当前值取反
      const cur = Number(s.disp) * (s.pendingNeg ? -1 : 1);
      const v =
        (s.pendOp === '+' || s.pendOp === '−') && s.pendVal !== null
          ? (s.pendVal * cur) / 100
          : cur / 100;
      return { ...s, disp: numToString(Math.round(v * 1e10) / 1e10), typing: false, pendingNeg: false };
    }
    case 'op': {
      if (s.err) return s;
      let disp = s.disp;
      let pendVal = s.pendVal;
      if (s.typing) {
        // #23: typing=true 时 pendingNeg 已在 digit 阶段消费（disp 含负号），无需再乘
        if (s.pendOp !== null && pendVal !== null) {
          const r = pCompute(pendVal, Number(s.disp), s.pendOp);
          if (r === null) return P_ERR;
          disp = numToString(r);
          pendVal = r;
        } else {
          pendVal = Number(s.disp);
        }
      } else if (s.pendOp === null || pendVal === null) {
        // 等号后/首次输入：以当前显示值作为第一操作数；换运算符/清零后保持原值
        // #23: pendingNeg 作用于第一操作数
        pendVal = Number(s.disp) * (s.pendingNeg ? -1 : 1);
      }
      return { ...s, disp, pendVal, pendOp: a.op, typing: false, lastOp: null, hist: `${fmt(pendVal)} ${a.op}`, pendingNeg: false };
    }
    case 'eq': {
      if (s.err) return s;
      if (s.pendOp !== null && s.pendVal !== null) {
        // #23: pendingNeg 作用于第二操作数 b
        const b = Number(s.disp) * (s.pendingNeg ? -1 : 1);
        const r = pCompute(s.pendVal, b, s.pendOp);
        if (r === null) return P_ERR;
        return {
          ...s,
          disp: numToString(r),
          hist: `${fmt(s.pendVal)} ${s.pendOp} ${fmt(b)} =`,
          pendOp: null,
          pendVal: null,
          typing: false,
          lastOp: { op: s.pendOp, val: b },
          pendingNeg: false,
        };
      }
      if (s.lastOp !== null) {
        const cur = Number(s.disp) * (s.pendingNeg ? -1 : 1);
        const r = pCompute(cur, s.lastOp.val, s.lastOp.op);
        if (r === null) return P_ERR;
        return { ...s, disp: numToString(r), hist: `${fmt(cur)} ${s.lastOp.op} ${fmt(s.lastOp.val)} =`, typing: false, pendingNeg: false };
      }
      return { ...s, typing: false, pendingNeg: false };
    }
    case 'clear': {
      if (s.err) return P_INIT;
      if (s.typing) return { ...s, disp: '0', typing: false };
      return P_INIT;
    }
  }
}

/* ==================== 科学模式：tokenizer + shunting-yard ==================== */

type Tok = { t: 'num'; v: number } | { t: 'fn'; name: string } | { t: 'op'; sym: string } | { t: 'lp' } | { t: 'rp' };
type RpnItem = number | string;

const PREC: Record<string, number> = { '+': 2, '−': 2, '×': 3, '÷': 3, '^': 4, neg: 4 };
const RIGHT_ASSOC = new Set(['^', 'neg']);
const FN_RE = /^(?:sin|cos|tan|ln|log|sqrt|√)\(/;
const NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-−]?\d+)?/;

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/[0-9.]/.test(ch)) {
      const m = NUM_RE.exec(src.slice(i));
      if (!m) return null;
      const v = Number(m[0]);
      if (!Number.isFinite(v)) return null;
      toks.push({ t: 'num', v });
      i += m[0].length;
      continue;
    }
    if (ch === 'π') {
      toks.push({ t: 'num', v: Math.PI });
      i += 1;
      continue;
    }
    if (ch === 'e') {
      toks.push({ t: 'num', v: Math.E });
      i += 1;
      continue;
    }
    const fm = FN_RE.exec(src.slice(i));
    if (fm) {
      toks.push({ t: 'fn', name: fm[0].startsWith('√') ? 'sqrt' : fm[0].slice(0, -1) });
      i += fm[0].length;
      continue;
    }
    if (ch === '(') {
      toks.push({ t: 'lp' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      toks.push({ t: 'rp' });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '−' || ch === '-' || ch === '×' || ch === '÷' || ch === '^' || ch === '%') {
      toks.push({ t: 'op', sym: ch === '-' ? '−' : ch });
      i += 1;
      continue;
    }
    return null;
  }
  return toks;
}

function toRPN(toks: Tok[]): RpnItem[] | null {
  const out: RpnItem[] = [];
  const stack: string[] = [];
  let prev: Tok | null = null;
  for (const tk of toks) {
    if (tk.t === 'num') {
      if (prev && (prev.t === 'num' || prev.t === 'rp')) return null;
      out.push(tk.v);
    } else if (tk.t === 'fn') {
      if (prev && (prev.t === 'num' || prev.t === 'rp')) return null;
      stack.push(`fn:${tk.name}`);
    } else if (tk.t === 'lp') {
      stack.push('(');
    } else if (tk.t === 'rp') {
      let closed = false;
      while (stack.length > 0) {
        const top = stack.pop();
        if (top === undefined) return null;
        if (top === '(') {
          closed = true;
          break;
        }
        out.push(top);
      }
      if (!closed) return null;
      const top2 = stack[stack.length - 1];
      if (top2 !== undefined && top2.startsWith('fn:')) out.push(stack.pop() as string);
    } else {
      let sym = tk.sym;
      const unary = sym === '−' && (prev === null || prev.t === 'op' || prev.t === 'lp');
      if (unary) sym = 'neg';
      if (sym === '%') {
        if (!prev || (prev.t !== 'num' && prev.t !== 'rp')) return null;
        out.push('%');
        prev = tk;
        continue;
      }
      if (!unary && (prev === null || prev.t === 'op' || prev.t === 'lp')) return null;
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top === undefined || top === '(') break;
        const tp = top.startsWith('fn:') ? 9 : PREC[top] ?? 0;
        const cp = PREC[sym] ?? 0;
        if (tp > cp || (tp === cp && !RIGHT_ASSOC.has(sym))) {
          stack.pop();
          out.push(top);
        } else break;
      }
      stack.push(sym);
    }
    prev = tk;
  }
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) return null;
    if (top === '(') return null;
    out.push(top);
  }
  return out;
}

function applyFn(name: string, x: number): number | null {
  let r = NaN;
  if (name === 'sin') r = Math.sin(x);
  else if (name === 'cos') r = Math.cos(x);
  else if (name === 'tan') r = Math.tan(x);
  else if (name === 'ln') r = x > 0 ? Math.log(x) : NaN;
  else if (name === 'log') r = x > 0 ? Math.log10(x) : NaN;
  else if (name === 'sqrt') r = x >= 0 ? Math.sqrt(x) : NaN;
  return Number.isFinite(r) ? r : null;
}

function evalRPN(rpn: RpnItem[]): number | null {
  const st: number[] = [];
  for (const it of rpn) {
    if (typeof it === 'number') {
      st.push(it);
      continue;
    }
    if (it === 'neg') {
      const a = st.pop();
      if (a === undefined) return null;
      st.push(-a);
      continue;
    }
    if (it === '%') {
      const a = st.pop();
      if (a === undefined) return null;
      st.push(a / 100);
      continue;
    }
    if (it.startsWith('fn:')) {
      const a = st.pop();
      if (a === undefined) return null;
      const r = applyFn(it.slice(3), a);
      if (r === null) return null;
      st.push(r);
      continue;
    }
    const b = st.pop();
    const a = st.pop();
    if (a === undefined || b === undefined) return null;
    let r = NaN;
    if (it === '+') r = a + b;
    else if (it === '−') r = a - b;
    else if (it === '×') r = a * b;
    else if (it === '÷') r = b === 0 ? NaN : a / b;
    else if (it === '^') r = Math.pow(a, b);
    else return null;
    if (!Number.isFinite(r)) return null;
    st.push(r);
  }
  const v = st.pop();
  return v !== undefined && st.length === 0 && Number.isFinite(v) ? v : null;
}

/* ==================== 科学模式：表达式构建 ==================== */

interface SciState {
  expr: string;
  res: string | null;
  err: boolean;
}

const SCI_EMPTY: SciState = { expr: '', res: null, err: false };
const VAL_END = /[0-9.)πe%]$/;
const OP_END = /[+−×÷^]$/;
const ENTRY_RE = /(?:\d+\.?\d*|\.\d+)(?:e[+\-−]?\d+)?$|(?:π|e)$/;

function trailingEntry(expr: string): string {
  const m = ENTRY_RE.exec(expr);
  return m ? m[0] : '';
}

const sciSeed = (s: SciState, expr: string): SciState => ({ ...s, expr, res: null, err: false });

function sciValue(s: SciState, token: string): SciState {
  if (s.err) return s;
  if (s.res !== null) return sciSeed(s, token);
  return sciSeed(s, s.expr + (VAL_END.test(s.expr) ? '×' : '') + token);
}

function sciDigit(s: SciState, d: string): SciState {
  if (s.err) return s;
  if (s.res !== null) return sciSeed(s, d);
  const entry = trailingEntry(s.expr);
  if (/^[0-9.]/.test(entry)) {
    if (entry === '0') return sciSeed(s, s.expr.slice(0, -1) + d);
    if (entry.length >= 12) return s;
    return sciSeed(s, s.expr + d);
  }
  return sciSeed(s, s.expr + (VAL_END.test(s.expr) ? '×' : '') + d);
}

function sciDot(s: SciState): SciState {
  if (s.err) return s;
  if (s.res !== null) return sciSeed(s, '0.');
  const entry = trailingEntry(s.expr);
  if (/^[0-9.]/.test(entry)) {
    if (entry.includes('.') || entry.includes('e')) return s;
    return sciSeed(s, s.expr + '.');
  }
  return sciSeed(s, s.expr + (VAL_END.test(s.expr) ? '×' : '') + '0.');
}

function sciOp(s: SciState, op: string): SciState {
  if (s.err) return s;
  let expr: string;
  if (s.res !== null) {
    const seed = s.res.replace(/-/g, '−');
    expr = op === '^' && seed.startsWith('−') ? `(${seed})` : seed;
  } else {
    expr = s.expr;
  }
  if (expr === '') return op === '−' ? sciSeed(s, '−') : s;
  const last = expr.slice(-1);
  if (OP_END.test(last)) return sciSeed(s, expr.slice(0, -1) + op);
  if (last === '(' && op !== '−') return s;
  return sciSeed(s, expr + op);
}

function sciPct(s: SciState): SciState {
  if (s.err) return s;
  if (s.res !== null) return sciSeed(s, s.res.replace(/-/g, '−') + '%');
  if (!VAL_END.test(s.expr) || s.expr.endsWith('%')) return s;
  return sciSeed(s, s.expr + '%');
}

function sciSq(s: SciState): SciState {
  if (s.err) return s;
  if (s.res !== null) return sciSeed(s, `(${s.res.replace(/-/g, '−')})^2`);
  if (!VAL_END.test(s.expr)) return s;
  return sciSeed(s, s.expr + '^2');
}

function sciRP(s: SciState): SciState {
  if (s.err || s.res !== null) return s;
  const open = (s.expr.match(/\(/g) ?? []).length;
  const close = (s.expr.match(/\)/g) ?? []).length;
  if (open <= close || !VAL_END.test(s.expr)) return s;
  return sciSeed(s, s.expr + ')');
}

function sciNeg(s: SciState): SciState {
  if (s.err) return s;
  if (s.res !== null) {
    const seed = s.res.replace(/-/g, '−');
    return sciSeed(s, seed.startsWith('−') ? seed.slice(1) : `−${seed}`);
  }
  const m = /(?:\d+\.?\d*|\.\d+)(?:e[+\-−]?\d+)?$/.exec(s.expr);
  if (!m || m[0] === '') {
    // #23: 无尾随数字时（空表达式或运算符后），插入 − 开启负的下一操作数（如 5+ +/- 3 = → 5+−3 = 2）
    if (s.expr === '' || OP_END.test(s.expr.slice(-1))) {
      return sciSeed(s, s.expr + '−');
    }
    return s;
  }
  const i = m.index;
  const before = s.expr.charAt(i - 1);
  if (before === '−') {
    const prevChar = s.expr.charAt(i - 2);
    if (i - 1 === 0 || !VAL_END.test(prevChar)) {
      return sciSeed(s, s.expr.slice(0, i - 1) + s.expr.slice(i));
    }
  }
  return sciSeed(s, `${s.expr.slice(0, i)}−${s.expr.slice(i)}`);
}

function sciBack(s: SciState): SciState {
  if (s.err || s.res !== null) return { ...SCI_EMPTY };
  if (s.expr === '') return s;
  const entry = trailingEntry(s.expr);
  if (entry !== '') return sciSeed(s, s.expr.slice(0, s.expr.length - entry.length));
  const m = /(?:sin\(|cos\(|tan\(|ln\(|log\(|√\(|\^2|[+−×÷^%()πe])$/.exec(s.expr);
  return sciSeed(s, s.expr.slice(0, s.expr.length - (m ? m[0].length : 1)));
}

function sciEq(s: SciState): SciState {
  if (s.err || s.res !== null) return s;
  let expr = s.expr.replace(/[+−×÷^]+$/, '');
  if (expr === '' || expr.endsWith('(')) return s;
  const open = (expr.match(/\(/g) ?? []).length;
  const close = (expr.match(/\)/g) ?? []).length;
  if (open > close) expr += ')'.repeat(open - close);
  const toks = tokenize(expr);
  const rpn = toks ? toRPN(toks) : null;
  if (!rpn) return { ...s, err: true };
  const val = evalRPN(rpn);
  if (val === null) return { ...s, err: true };
  return { ...s, expr, res: numToString(val), err: false };
}

function sciMainOf(s: SciState): string {
  if (s.err) return '错误';
  if (s.res !== null) return toDisplay(s.res);
  const entry = trailingEntry(s.expr);
  if (entry === '') return '0';
  if (s.expr.startsWith('−') && entry.length === s.expr.length - 1) return `−${entry}`;
  return entry;
}

const SCI_KEYS: Array<{ label: string; aria: string; run: (s: SciState) => SciState }> = [
  { label: 'sin', aria: '正弦', run: (s) => sciValue(s, 'sin(') },
  { label: 'cos', aria: '余弦', run: (s) => sciValue(s, 'cos(') },
  { label: 'tan', aria: '正切', run: (s) => sciValue(s, 'tan(') },
  { label: 'ln', aria: '自然对数', run: (s) => sciValue(s, 'ln(') },
  { label: 'log', aria: '常用对数', run: (s) => sciValue(s, 'log(') },
  { label: '√', aria: '平方根', run: (s) => sciValue(s, '√(') },
  { label: 'x²', aria: '平方', run: sciSq },
  { label: 'xʸ', aria: '幂运算', run: (s) => sciOp(s, '^') },
  { label: 'π', aria: '圆周率', run: (s) => sciValue(s, 'π') },
  { label: 'e', aria: '自然常数', run: (s) => sciValue(s, 'e') },
  { label: '(', aria: '左括号', run: (s) => sciValue(s, '(') },
  { label: ')', aria: '右括号', run: sciRP },
  { label: '^', aria: '乘方', run: (s) => sciOp(s, '^') },
  { label: 'AC', aria: '全部清除', run: () => SCI_EMPTY },
  { label: '%', aria: '百分比', run: sciPct },
];

/* ==================== UI ==================== */

/* iOS 18 配色（随主题自适应，父容器有 .dark 类）：
   浅色：数字 #E9E9EB 黑字 / 功能键 #D4D4D2 黑字 / 运算符橙底白字 / 激活反白白底橙字 / 科学键 #D1D1D6
   深色：数字 #333333 白字 / 功能键 #A5A5A5 黑字 / 运算符、激活态不变 / 科学键 #A5A5A5 */
const DIGIT = 'bg-[#E9E9EB] text-black dark:bg-[#333333] dark:text-white';
const FUNC = 'bg-[#D4D4D2] text-black dark:bg-[#A5A5A5] dark:text-black';
const ORANGE = 'bg-[#FF9F0A] text-white';
const OP_ACTIVE = 'bg-white text-[#FF9F0A]';
const SCI_TONE = 'bg-[#D1D1D6] text-black dark:bg-[#A5A5A5] dark:text-black';

function Key(props: {
  label: string;
  onPress: () => void;
  tone: string;
  text: string;
  aria?: string;
  square?: boolean;
  wide?: boolean;
  className?: string;
}) {
  const { square = true, wide = false } = props;
  return (
    <button
      type="button"
      aria-label={props.aria ?? props.label}
      onClick={() => {
        // 轻触感反馈（不支持震动的环境静默忽略）
        try {
          navigator.vibrate?.(6);
        } catch {
          /* 震动不可用 */
        }
        props.onPress();
      }}
      className={`flex select-none items-center justify-center rounded-full text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.30),inset_0_-1px_0_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.10)] transition-all duration-75 active:scale-[0.93] active:brightness-110 ${props.tone} ${props.text} ${
        wide ? 'col-span-2 justify-start' : square ? 'aspect-square' : ''
      } ${props.className ?? ''}`}
    >
      {props.label}
    </button>
  );
}

function Display(props: { hist: string; main: string; landscape: boolean }) {
  const len = props.main.length;
  const size = props.landscape
    ? len <= 8
      ? 'text-[40px]'
      : len <= 12
        ? 'text-[28px]'
        : 'text-[20px]'
    : len <= 9
      ? 'text-[72px]'
      : len <= 12
        ? 'text-[52px]'
        : 'text-[34px]';
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col items-end justify-end overflow-hidden px-5 pt-[54px] ${props.landscape ? 'pb-1' : 'pb-3'}`}
    >
      <div
        className={`max-w-full truncate font-light tabular-nums tracking-wide text-muted-foreground/80 ${props.landscape ? 'h-5 text-[13px] leading-5' : 'h-6 text-[17px] leading-6'}`}
      >
        {props.hist}
      </div>
      <div
        aria-live="polite"
        className={`max-w-full truncate font-light leading-none tabular-nums tracking-tight text-foreground ${size}`}
      >
        {props.main}
      </div>
    </div>
  );
}

function StandardKeys(props: {
  layout: 'portrait' | 'landscape';
  acLabel: string;
  activeOp: OpSym | null;
  onDigit: (d: string) => void;
  onDot: () => void;
  onOp: (op: OpSym) => void;
  onEq: () => void;
  onAc: () => void;
  onNeg: () => void;
  onPct: () => void;
}) {
  const portrait = props.layout === 'portrait';
  const text = portrait ? 'text-[32px]' : 'text-[24px]';
  const opTone = (op: OpSym) => (props.activeOp === op ? OP_ACTIVE : ORANGE);
  const dig = (d: string) => (
    <Key key={d} label={d} tone={DIGIT} text={text} square={portrait} onPress={() => props.onDigit(d)} />
  );
  return (
    <div className={portrait ? 'grid grid-cols-4 gap-3 px-4 pb-9' : 'grid min-w-0 flex-[4] grid-cols-4 grid-rows-5 gap-2'}>
      <Key
        label={props.acLabel}
        tone={FUNC}
        text={text}
        square={portrait}
        onPress={props.onAc}
        aria={props.acLabel === 'AC' ? '全部清除' : '清除当前输入'}
      />
      <Key label="+/−" tone={FUNC} text={text} square={portrait} onPress={props.onNeg} aria="正负号" />
      <Key label="%" tone={FUNC} text={text} square={portrait} onPress={props.onPct} aria="百分比" />
      <Key label="÷" tone={opTone('÷')} text={text} square={portrait} onPress={() => props.onOp('÷')} aria="除以" />
      {dig('7')}
      {dig('8')}
      {dig('9')}
      <Key label="×" tone={opTone('×')} text={text} square={portrait} onPress={() => props.onOp('×')} aria="乘以" />
      {dig('4')}
      {dig('5')}
      {dig('6')}
      <Key label="−" tone={opTone('−')} text={text} square={portrait} onPress={() => props.onOp('−')} aria="减去" />
      {dig('1')}
      {dig('2')}
      {dig('3')}
      <Key label="+" tone={opTone('+')} text={text} square={portrait} onPress={() => props.onOp('+')} aria="加上" />
      <Key
        label="0"
        tone={DIGIT}
        text={text}
        square={false}
        wide
        className={portrait ? 'pl-7' : 'pl-4'}
        onPress={() => props.onDigit('0')}
      />
      <Key label="." tone={DIGIT} text={text} square={portrait} onPress={props.onDot} aria="小数点" />
      <Key label="=" tone={ORANGE} text={text} square={portrait} onPress={props.onEq} aria="等于" />
    </div>
  );
}

/* ==================== App ==================== */

export default function CalculatorApp() {
  const [landscape, setLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
  );
  const [p, dispatch] = useReducer(portraitReducer, P_INIT);
  const [s, setS] = useState<SciState>(SCI_EMPTY);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = (e: MediaQueryListEvent) => setLandscape(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (landscape) {
    const hist = s.expr === '' ? '' : s.expr + (s.res !== null ? ' =' : '');
    return (
      <div className="flex h-full w-full touch-manipulation select-none flex-col overflow-hidden bg-background text-foreground">
        <BackToHome />
        <Display hist={hist} main={sciMainOf(s)} landscape />
        <div className="flex min-h-0 w-full max-h-[460px] flex-[2] gap-2 px-3 pb-8">
          <div className="grid min-w-0 flex-[5] grid-cols-5 grid-rows-3 gap-2">
            {SCI_KEYS.map((k) => (
              <Key
                key={k.label}
                label={k.label}
                aria={k.aria}
                tone={SCI_TONE}
                text="text-[19px]"
                square={false}
                onPress={() => setS((prev) => k.run(prev))}
              />
            ))}
          </div>
          <StandardKeys
            layout="landscape"
            acLabel={s.expr === '' && s.res === null && !s.err ? 'AC' : 'C'}
            activeOp={null}
            onDigit={(d) => setS((prev) => sciDigit(prev, d))}
            onDot={() => setS((prev) => sciDot(prev))}
            onOp={(op) => setS((prev) => sciOp(prev, op))}
            onEq={() => setS((prev) => sciEq(prev))}
            onAc={() => setS((prev) => sciBack(prev))}
            onNeg={() => setS((prev) => sciNeg(prev))}
            onPct={() => setS((prev) => sciPct(prev))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full touch-manipulation select-none flex-col overflow-hidden bg-background text-foreground">
      <BackToHome />
      <Display hist={p.hist} main={toDisplay(p.disp)} landscape={false} />
      <StandardKeys
        layout="portrait"
        acLabel={p.typing && !p.err ? 'C' : 'AC'}
        activeOp={p.err ? null : p.pendOp}
        onDigit={(d) => dispatch({ t: 'digit', d })}
        onDot={() => dispatch({ t: 'dot' })}
        onOp={(op) => dispatch({ t: 'op', op })}
        onEq={() => dispatch({ t: 'eq' })}
        onAc={() => dispatch({ t: 'clear' })}
        onNeg={() => dispatch({ t: 'neg' })}
        onPct={() => dispatch({ t: 'pct' })}
      />
    </div>
  );
}
