'use client';

/**
 * 应用内自动化层（v1.7.0「他什么都能做」）：
 *
 * Mobile Agent 原有的动作（openApp/clickElement/…）走 Shizuku 操作 Android 系统级 UI
 * （uiautomator dump 看到的是 WebView 整体一个节点，点不到虚拟手机里的界面元素）。
 * 本层补上「这个项目自己的 APP 界面」的直接操控能力——纯 DOM 级，不需要 Shizuku：
 *
 * - openScreen：打开项目内任意 App 界面（AppId 或中文名，如「微信」「contacts」）
 *   （v1.9.5：Agent 运行进度卡等自身浮层不再遮挡观察/点按——任务期间顶部导航的
 *   完成/保存类按钮照常可见可点，任务不再总差最后一步）
 * - uiObserve：观察当前打开的 App 界面——枚举可点元素（按钮/列表项/标签页）与输入框，
 *   输出紧凑清单喂给 LLM（uiClick 的 args 照抄清单里的文字即可）
 * - uiClick：按文字匹配点击界面元素（pointer/touch/mouse 全事件序列，兼容 React 合成事件
 *   与 onTouchEnd 类自定义组件）
 * - uiType：向聚焦输入框输入文字（React 受控组件走 prototype 原生 setter + input 事件；
 *   contenteditable 走 execCommand insertText）
 * - uiScroll：在当前 App 界面里滚动翻页（找到最大可见滚动容器 scrollBy，wheel 事件兜底）
 *
 * 约束：
 * - 只在 [data-phone-shell] 壳内找元素（不碰手机外的页面），并排除语音会话层自身，
 *   避免观察/点按到 Agent 自己的 UI；
 * - 元素定位全部按可见文字/占位符匹配（不依赖坐标），跨分辨率天然稳定；
 * - 所有函数返回 StepResult 形状 { ok, text }，文案直接进 Agent history 给 LLM 反馈。
 */

import type { AppId } from './store';
import { useUI } from './store';
import { useIncomingCall } from './incoming-call';

// ============================================================
// A. 项目内应用注册表（prompt 文档 + 中文名解析）
// ============================================================

export interface ScreenAppMeta {
  id: AppId;
  name: string;
  /** 中文别名（LLM 口语化说法兜底） */
  aliases?: string[];
}

/** 项目内全部可打开的 App 界面（与 registry.tsx / AppId 保持一致） */
export const SCREEN_APPS: ScreenAppMeta[] = [
  { id: 'chat', name: '信息' },
  { id: 'wechat', name: '微信' },
  { id: 'qq', name: 'QQ' },
  { id: 'taobao', name: '淘宝' },
  { id: 'phone', name: '电话' },
  { id: 'photos', name: '照片' },
  { id: 'camera', name: '相机' },
  { id: 'music', name: '音乐' },
  { id: 'browser', name: '浏览器' },
  { id: 'weather', name: '天气' },
  { id: 'clock', name: '时钟' },
  { id: 'themes', name: '主题' },
  { id: 'files', name: '文件' },
  { id: 'reminders', name: '提醒事项' },
  { id: 'calculator', name: '计算器' },
  { id: 'notes', name: '备忘录' },
  { id: 'calendar', name: '日历' },
  { id: 'recorder', name: '语音备忘录' },
  { id: 'contacts', name: '联系人', aliases: ['通讯录', '通讯录应用'] },
  { id: 'settings', name: '设置' },
  { id: 'appstore', name: 'App Store', aliases: ['商店', '应用商店'] },
  { id: 'memory', name: '记忆库', aliases: ['记忆'] },
  { id: 'worldbook', name: '世界书' },
  { id: 'meituan', name: '美团' },
  { id: 'couple', name: '情侣空间', aliases: ['情侣'] },
  { id: 'cottage', name: '拾光小屋', aliases: ['小屋', '拾光'] },
  { id: 'forum', name: 'X论坛', aliases: ['论坛'] },
];

/** 注入 Agent prompt 的应用清单（openScreen 的 args 可填 id 或中文名） */
export const SCREEN_APPS_DOC = SCREEN_APPS.map((a) => `${a.id}=${a.name}`).join('/');

/** 解析 LLM 给的 openScreen 参数：AppId 精确匹配 → 中文名/别名精确 → 包含匹配（≥2 字） */
export function resolveScreenApp(raw: string): ScreenAppMeta | null {
  const q = raw.trim().toLowerCase().replace(/["'「」『』\s]/g, '');
  if (!q) return null;
  const exact = SCREEN_APPS.find((a) => a.id === q || a.name.toLowerCase() === q || a.aliases?.some((x) => x.toLowerCase() === q));
  if (exact) return exact;
  // 包含匹配：应用名包含参数或参数包含应用名（如「打开微信app」「信息应用」）
  return (
    SCREEN_APPS.find(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        q.includes(a.name.toLowerCase()) ||
        a.aliases?.some((x) => x.toLowerCase().includes(q) || q.includes(x.toLowerCase())),
    ) ?? null
  );
}

// ============================================================
// B. 壳内 DOM 根与可见性工具
// ============================================================

export interface ScreenDomResult {
  ok: boolean;
  text: string;
}

/** 语音会话层自身（观察/点按时排除，避免 Agent 操控自己的 UI） */
const EXCLUDE_ATTR = 'data-agent-voice-layer';

/**
 * v1.9.5 Agent 全局浮层标记（AgentRunnerBar / 灵动岛通知卡）：观察清单排除 + 遮挡判定豁免。
 *
 * 为什么必须豁免：这些浮层悬浮在 App 界面之上（进度卡正好盖住顶部导航），若按普通遮挡
 * 判定，任务运行期间 Agent 永远「看不见」App 顶栏的完成/保存类按钮——UI 任务总差最后
 * 一步（用户实测：写备忘录内容输完了，就是找不到保存按钮）。点按走 dispatchTap 直接
 * 对元素派发事件（不经过 elementFromPoint），所以豁免遮挡后观察与点按双通，任务不再
 * 被自己的浮层拦住。敏感操作确认卡（AgentConfirmHost）是有意不豁免的模态——必须先应答。 */
const OVERLAY_ATTR = 'data-agent-ui';

/** 找当前可见的手机壳根元素（横竖屏/桌面壳多个副本里取有尺寸的那个） */
function shellRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const shells = document.querySelectorAll<HTMLElement>('[data-phone-shell]');
  for (const el of shells) {
    if (el.offsetWidth > 40 && el.offsetHeight > 40) return el;
  }
  return null;
}

/** 元素是否可见（有几何尺寸、在壳矩形内、未隐藏、中心点未被其它层盖住） */
function isVisible(el: Element, shellRect: DOMRect): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 8) return false;
  if (r.right < shellRect.left || r.left > shellRect.right || r.bottom < shellRect.top || r.top > shellRect.bottom) return false;
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.08) return false;
  // 遮挡检查：中心点最顶层的元素必须是自身/子孙/祖先（App 窗口下面的主屏图标、
  // 弹层下面的列表项都会在此被滤掉，观察清单不再混入「看不见」的元素）。
  // v1.9.5：Agent 自身浮层（[data-agent-ui]，运行进度卡/灵动岛通知卡）不算遮挡——
  // 否则任务运行期间顶部导航的「完成/保存」类按钮被进度卡盖住，永远看不见点不着。
  const cx = Math.min(Math.max(r.left + r.width / 2, r.left + 1), r.right - 1);
  const cy = Math.min(Math.max(r.top + r.height / 2, r.top + 1), r.bottom - 1);
  const top = document.elementFromPoint(cx, cy);
  if (top && !el.contains(top) && !top.contains(el) && !top.closest(`[${OVERLAY_ATTR}]`)) return false;
  return true;
}

/** 元素是否在排除子树里（语音会话层、Agent 运行进度卡等 Agent 自身 UI） */
function inExcluded(el: Element): boolean {
  return !!el.closest(`[${EXCLUDE_ATTR}],[${OVERLAY_ATTR}]`);
}

/** 压缩空白并截断的元素标签文本 */
function labelOf(el: HTMLElement): string {
  const raw =
    el.getAttribute('aria-label') ||
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.getAttribute('placeholder') || el.value
      : el.innerText) ||
    '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 30);
}

// ============================================================
// C. openScreen：打开项目内 App 界面
// ============================================================

const sleep = (ms: number): Promise<void> => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * 打开项目内 App（等 App 完全展开 + 渲染 grace 才返回，settle 由本函数内置）。
 * 已在目标 App 时直接成功；锁屏时失败提示。
 */
export async function openScreenApp(raw: string): Promise<ScreenDomResult> {
  const meta = resolveScreenApp(raw);
  if (!meta) {
    return { ok: false, text: `找不到应用「${raw.trim()}」。可用应用：${SCREEN_APPS_DOC}` };
  }
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) {
    return { ok: false, text: '手机处于锁定/熄屏状态，请先亮屏解锁（此动作不能替代解锁）' };
  }
  let incomingBlocked = false;
  try {
    incomingBlocked = !!useIncomingCall.getState().call;
  } catch {
    /* store 异常不拦截 */
  }
  if (ui.alarmRinging || incomingBlocked) {
    return { ok: false, text: '当前有闹钟响铃/来电弹层在前台，无法打开应用' };
  }
  if (ui.activeApp === meta.id && ui.phase === 'open') {
    return { ok: true, text: `已在「${meta.name}」内` };
  }
  if (ui.activeApp || ui.phase !== 'closed') {
    useUI.getState().switchToApp(meta.id);
  } else {
    useUI.getState().openApp(meta.id);
  }
  // 等 App 完全展开（openApp 有两帧 rAF 的 opening→open；冷启动还有 dynamic chunk 拉取）
  const deadline = Date.now() + 5000;
  for (;;) {
    await sleep(100);
    const s = useUI.getState();
    if (s.activeApp === meta.id && s.phase === 'open') break;
    if (Date.now() > deadline) {
      return { ok: false, text: `打开「${meta.name}」超时（界面未展开）` };
    }
  }
  await sleep(600); // 首帧渲染 grace（AppSplash→真实界面的过渡）
  return { ok: true, text: `已打开「${meta.name}」` };
}

// ============================================================
// D. uiObserve：观察当前 App 界面
// ============================================================

/** 可点元素候选选择器（一次 querySelectorAll 拿全） */
const CLICKABLE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[data-switch]',
].join(',');

interface ClickableItem {
  el: HTMLElement;
  label: string;
  area: number;
  isInput: boolean;
}

/** 可点元素排前、输入框排后；同类按 DOM 顺序（界面从上到下） */
function sortItems(out: ClickableItem[]): ClickableItem[] {
  return out.sort((a, b) => {
    if (a.isInput !== b.isInput) return a.isInput ? 1 : -1;
    const pos = a.el.compareDocumentPosition(b.el);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

/** 收集壳内可交互元素（按钮类 + 输入类），同文本去重保最小面积（最具体元素） */
function collectClickables(root: HTMLElement, shellRect: DOMRect): ClickableItem[] {
  const out: ClickableItem[] = [];
  const seen = new Map<string, ClickableItem>();
  const push = (el: HTMLElement, isInput: boolean): void => {
    if (inExcluded(el)) return;
    const label = labelOf(el);
    if (!label) return;
    const r = el.getBoundingClientRect();
    const item: ClickableItem = { el, label, area: r.width * r.height, isInput };
    const prev = seen.get(`${isInput ? 'i' : 'c'}:${label}`);
    if (!prev || item.area < prev.area) seen.set(`${isInput ? 'i' : 'c'}:${label}`, item);
  };
  // ① 语义可交互元素
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR))) {
    if (!isVisible(el, shellRect)) continue;
    push(el, el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
  }
  // ② cursor:pointer 的自定义可点元素（列表项/div onClick 等；上限防大 DOM 卡顿）
  const all = Array.from(root.querySelectorAll<HTMLElement>('div,li,span,img,td,p'));
  for (let i = 0; i < all.length && i < 4000; i++) {
    const el = all[i];
    if (el.querySelector(CLICKABLE_SELECTOR)) continue; // 容器（子元素已收）
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    if (!isVisible(el, shellRect)) continue;
    push(el, false);
  }
  for (const it of seen.values()) out.push(it);
  return sortItems(out);
}

/** 观察当前打开的 App 界面（可点元素 + 输入框清单，喂给 LLM 做 uiClick/uiType 决策） */
export function observeScreenDom(): ScreenDomResult {
  const root = shellRoot();
  if (!root) return { ok: false, text: '当前不在手机界面（找不到手机壳）' };
  const ui = useUI.getState();
  const appName = ui.activeApp ? (SCREEN_APPS.find((a) => a.id === ui.activeApp)?.name ?? ui.activeApp) : '主屏幕';
  if (!ui.activeApp) {
    return { ok: true, text: `[界面观察] 当前在主屏幕（没有打开的应用）。桌面图标也是可点元素，uiClick 图标文字可打开应用；或用 openScreen 打开目标应用` };
  }
  const shellRect = root.getBoundingClientRect();
  const items = collectClickables(root, shellRect);
  const clicks = items.filter((i) => !i.isInput).slice(0, 40);
  const inputs = items.filter((i) => i.isInput).slice(0, 8);
  if (clicks.length === 0 && inputs.length === 0) {
    return { ok: true, text: `[界面观察] 当前应用：${appName}。没有观察到可点元素/输入框（可能是加载中或纯内容页），可稍后重试或 openScreen 换应用` };
  }
  const lines: string[] = [`[界面观察] 当前应用：${appName}`];
  if (clicks.length > 0) {
    lines.push('可点元素（uiClick 的 args 照抄引号内文字）：');
    lines.push(clicks.map((i, n) => `${n + 1}.「${i.label}」`).join(' '));
    if (items.filter((i) => !i.isInput).length > 40) lines.push('（元素过多只列前 40 个，目标不在其中就先 uiScroll 翻页再观察）');
  }
  if (inputs.length > 0) {
    lines.push('输入框（先 uiClick 点它聚焦，再 uiType 输入）：');
    lines.push(inputs.map((i) => `-「${i.label || '（空输入框）'}」`).join('\n'));
  }
  return { ok: true, text: lines.join('\n') };
}

// ============================================================
// E. uiClick：按文字点击
// ============================================================

/** 目标匹配打分：精确 3 > 目标包含标签/标签包含目标 2 > 单向模糊 1 */
function scoreMatch(label: string, target: string): number {
  const l = label.toLowerCase();
  const t = target.toLowerCase();
  if (l === t) return 3;
  if (l.includes(t) || t.includes(l)) return 2;
  return 0;
}

/** 全事件序列点击（pointer/mouse/touch/click——React 合成事件与自定义组件通吃）；
 *  每个事件用工厂闭包构造，规避各构造器 init 类型差异 */
function dispatchTap(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const base: MouseEventInit = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0 };
  const fire = (make: () => Event): void => {
    try {
      el.dispatchEvent(make());
    } catch {
      /* 单个事件失败继续（click 是主体） */
    }
  };
  const PE = window.PointerEvent ?? MouseEvent;
  fire(() => new PE('pointerdown', { ...base, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1 } as PointerEventInit));
  fire(() => new MouseEvent('mousedown', { ...base, buttons: 1 }));
  try {
    const touch = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    const tInit: TouchEventInit = { bubbles: true, cancelable: true, composed: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] };
    fire(() => new TouchEvent('touchstart', tInit));
    fire(() => new TouchEvent('touchend', { ...tInit, touches: [], targetTouches: [] }));
  } catch {
    /* 无 Touch 构造器的环境跳过触摸事件 */
  }
  fire(() => new PE('pointerup', { ...base, pointerId: 1, pointerType: 'touch', isPrimary: true } as PointerEventInit));
  fire(() => new MouseEvent('mouseup', base));
  fire(() => new MouseEvent('click', base));
}

/** 按文字点击当前 App 界面元素（找不到时反馈最接近的现有元素名帮 LLM 换词） */
export function clickScreenDom(target: string): ScreenDomResult {
  const t = target.trim().replace(/^["'「」]|["'「」]$/g, '');
  const root = shellRoot();
  if (!root) return { ok: false, text: '当前不在手机界面（找不到手机壳）' };
  if (!t) return { ok: false, text: 'uiClick 缺目标文字' };
  const items = collectClickables(root, root.getBoundingClientRect());
  let best: ClickableItem | null = null;
  let bestScore = 0;
  /** 同为包含匹配（score<3）时的其它候选项（歧义提示用） */
  const others: { label: string; score: number }[] = [];
  for (const it of items) {
    const s = scoreMatch(it.label, t);
    if (s <= 0) continue;
    if (s > bestScore || (s === bestScore && s > 0 && best && it.area < best.area)) {
      if (best && bestScore >= s) others.push({ label: best.label, score: bestScore });
      best = it;
      bestScore = s;
    } else if (best) {
      others.push({ label: it.label, score: s });
    }
  }
  if (!best || bestScore === 0) {
    const near = items
      .filter((i) => !i.isInput)
      .slice(0, 10)
      .map((i) => `「${i.label}」`)
      .join(' ');
    return { ok: false, text: `界面上找不到「${t}」。现在可见的元素：${near || '（无）'}——换匹配文字、先 uiScroll 翻页，或 uiObserve 重新观察` };
  }
  const el = best.el;
  // 不在视口内先滚到中间再点（列表长/键盘弹出场景）
  const vr = el.getBoundingClientRect();
  const shellRect = root.getBoundingClientRect();
  if (vr.top < shellRect.top + 8 || vr.bottom > shellRect.bottom - 8) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      /* ignore */
    }
  }
  dispatchTap(el);
  // 歧义护栏（v1.7.2 修「写备忘录点成新建文件夹」）：目标不是全称精确匹配、且界面上还有
  // 其它文字相近的候选时，把候选列进成功反馈——LLM（含验收轮）能看到并立即纠正
  let hint = '';
  if (bestScore < 3 && others.length > 0) {
    const near = [...new Set(others.filter((o) => o.score >= 2).map((o) => o.label))]
      .slice(0, 3)
      .map((l) => `「${l}」`)
      .join(' ');
    if (near) hint = `（注意：界面上还有相近元素 ${near}——如点错了，请用完整名称重试）`;
  }
  return { ok: true, text: `已点击「${best.label}」${hint}` };
}

// ============================================================
// F. uiType：向聚焦输入框输入
// ============================================================

/** React 受控组件赋值：走 prototype 原生 setter 绕过实例重写 + input/change 事件 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 找当前应输入的输入框：聚焦中的优先，否则取壳内第一个可见输入框 */
function pickInput(root: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active)) {
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable) {
      return active;
    }
  }
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'),
  );
  for (const el of candidates) {
    if (isVisible(el, root.getBoundingClientRect())) return el;
  }
  return null;
}

/** 向聚焦输入框输入文字（替换旧内容；contenteditable 走 execCommand） */
export function typeScreenDom(text: string): ScreenDomResult {
  const root = shellRoot();
  if (!root) return { ok: false, text: '当前不在手机界面（找不到手机壳）' };
  const t = text.trim();
  if (!t) return { ok: false, text: 'uiType 缺要输入的文字' };
  const input = pickInput(root);
  if (!input) {
    return { ok: false, text: '当前界面没有可输入的输入框（或没有输入框被聚焦）——先 uiClick 点一下输入框再 uiType' };
  }
  input.focus();
  if (input.isContentEditable) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('insertText', false, t);
      return { ok: true, text: `已在输入框输入「${t.slice(0, 20)}」` };
    } catch {
      return { ok: false, text: '富文本输入框输入失败——可改用 uiClick 点其它按钮' };
    }
  }
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    setNativeValue(input, t);
    return { ok: true, text: `已在输入框输入「${t.slice(0, 20)}」` };
  }
  return { ok: false, text: '该输入框类型暂不支持自动输入' };
}

// ============================================================
// G. uiScroll：当前 App 界面滚动翻页
// ============================================================

/** 找壳内最大的可见纵向/横向滚动容器 */
function pickScrollable(root: HTMLElement): HTMLElement | null {
  const shellRect = root.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestArea = 0;
  const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (let i = 0; i < all.length && i < 4000; i++) {
    const el = all[i];
    if (inExcluded(el)) continue;
    const st = getComputedStyle(el);
    const oy = st.overflowY;
    const ox = st.overflowX;
    if (oy !== 'auto' && oy !== 'scroll' && ox !== 'auto' && ox !== 'scroll') continue;
    if (!isVisible(el, shellRect)) continue;
    if (el.scrollHeight <= el.clientHeight + 20 && el.scrollWidth <= el.clientWidth + 20) continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/** 在当前 App 界面里滚动（上/下/左/右，默认下）；scrollBy 为主 + wheel 事件兜底 */
export function scrollScreenDom(dir: string): ScreenDomResult {
  const root = shellRoot();
  if (!root) return { ok: false, text: '当前不在手机界面（找不到手机壳）' };
  const d = (dir || '下').trim();
  const el = pickScrollable(root);
  if (!el) {
    // 兜底：对视口中心元素派发 wheel（部分列表滚动容器识别不到时）
    const cx = root.getBoundingClientRect();
    const target = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2);
    if (target) {
      const deltaY = d.includes('上') ? -600 : d.includes('左') ? 0 : d.includes('右') ? 0 : 600;
      const deltaX = d.includes('左') ? -600 : d.includes('右') ? 600 : 0;
      target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaX }));
      return { ok: true, text: `已向${d}滚动` };
    }
    return { ok: false, text: '当前界面没有可滚动区域' };
  }
  const v = el.clientHeight * 0.75;
  const h = el.clientWidth * 0.75;
  const top = d.includes('上') ? -v : d.includes('下') ? v : 0;
  const left = d.includes('左') ? -h : d.includes('右') ? h : 0;
  el.scrollBy({ top, left, behavior: 'smooth' });
  return { ok: true, text: `已向${d}滚动` };
}

// ============================================================
// H. 调试口（浏览器 console / E2E 验证用；仅挂一个 window 属性，零副作用）
// ============================================================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__agentScreen = {
    resolveScreenApp,
    openScreenApp,
    observeScreenDom,
    clickScreenDom,
    typeScreenDom,
    scrollScreenDom,
  };
}
