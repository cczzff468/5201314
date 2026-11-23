/**
 * 全局错误中心（v18 机主定调「网站全部错误的提示弄成弹窗」）：
 * - 任何界面不再直接铺错误长文——只留一个极简「错误/异常」入口，点击弹窗看详情
 *   （弹窗上半是错误标题、下半是错误详细原文）；
 * - 集中式 store：`report(title, detail)` 从任意位置上报（聊天发送失败 / 云端部署失败 /
 *   同步失败 / 全局未捕获异常 window.onerror / unhandledrejection…）；
 * - 顶部存最近 50 条；3 秒内同标题+详情的重复上报合并（防风暴刷屏）；
 * - 原始错误文本只进弹窗（可复制），界面常驻元素永远只有极简指示。
 */
import { create } from 'zustand';

export interface ErrorRec {
  id: string;
  /** 错误标题（分类名：「消息发送失败」「云端部署失败」「同步失败」「未捕获异常」…） */
  title: string;
  /** 错误详细（原始错误文本；仅弹窗内展示/复制，不进界面常驻元素） */
  detail: string;
  at: number;
  /** 来源标记（chat / cloud / sync / global…，调试定位用） */
  scope?: string;
  /** 弹窗内可选动作（如「重试」）：run 用 ref 包裹的闭包（避免过期 state） */
  actionLabel?: string;
  actionRun?: () => void;
}

const MAX_ERRORS = 50;

interface ErrorCenterState {
  errors: ErrorRec[];
  /** 弹窗打开时展示的错误 id；null = 列表模式（多条汇总） */
  openId: string | null;
  /** 列表模式（点全局指示器进来） */
  listMode: boolean;
  open: boolean;
  report: (title: string, detail: string, scope?: string, action?: { label: string; run: () => void }) => string;
  openList: () => void;
  openError: (id: string) => void;
  close: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

let lastReport = { title: '', detail: '', at: 0, id: '' };

export const useErrorCenter = create<ErrorCenterState>((set, get) => ({
  errors: [],
  openId: null,
  listMode: false,
  open: false,

  report: (title, detail, scope, action) => {
    const t = String(title || '错误').trim().slice(0, 60);
    const d = String(detail || '').trim().slice(0, 3000);
    const now = Date.now();
    // 同标题+同详情 → 合并进既有条目（同一问题只占一条；高频重报只刷新时间与动作闭包）。
    // v2.2.5 F-9 根修（机主实测「一个错误点进去聊天界面就显示一次」攒到 10 条）：
    // 旧版只比对最近一条 lastReport——聊天页多条错误行交替上报时永远对不上号，
    // 于是「每次进聊天界面」每条错误行都 re-report 一次、每条都新增一条错误。
    // 改为全列表查找同 title+detail 合并（刷新时间戳/动作），重复挂载变幂等；
    // 已被 dismiss（用户点了知道了）→ 条目不在列表 → 同错误复发视为新条目重新出现。
    const existed = get().errors.find((e) => e.title === t && e.detail === d);
    if (existed) {
      lastReport = { title: t, detail: d, at: now, id: existed.id };
      set((s) => ({
        errors: s.errors.map((e) =>
          e.id === existed.id
            ? { ...e, at: now, scope: scope ?? e.scope, actionLabel: action?.label, actionRun: action?.run }
            : e,
        ),
      }));
      return existed.id;
    }
    const id = 'err-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    lastReport = { title: t, detail: d, at: now, id };
    set((s) => ({ errors: [{ id, title: t, detail: d, at: now, scope, actionLabel: action?.label, actionRun: action?.run }, ...s.errors].slice(0, MAX_ERRORS) }));
    return id;
  },

  openList: () => set({ open: true, openId: null, listMode: true }),
  openError: (id) => set({ open: true, openId: id, listMode: false }),
  close: () => set({ open: false, openId: null, listMode: false }),
  dismiss: (id) =>
    set((s) => {
      const errors = s.errors.filter((e) => e.id !== id);
      const stillOpen = errors.length > 0;
      return { errors, open: stillOpen ? s.open : false, openId: s.openId === id ? null : s.openId };
    }),
  clearAll: () => set({ errors: [], open: false, openId: null, listMode: false }),
}));

/** 便捷上报（组件外可用）：返回错误 id（可带去直接弹窗） */
export function reportError(title: string, detail: string, scope?: string, action?: { label: string; run: () => void }): string {
  return useErrorCenter.getState().report(title, detail, scope, action);
}

/** 从任意 Error/unknown 提取可读文本（全局兜底监听用） */
export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name || 'Error'}: ${e.message}`;
  return String(e ?? '');
}

/** 全局兜底监听：window 未捕获错误 + 未处理的 Promise 拒绝 → 统一进错误中心。
 *  挂载一次（ErrorCenter 组件的 effect 里安装），覆盖「网站全部错误」的最后一层。 */
export function installGlobalErrorListeners(): () => void {
  const onErr = (ev: ErrorEvent) => {
    // Next HMR 的脚本注入错误忽略（dev 噪音）
    if (/import.meta|HotModule|Module \"\.\/.*\" not found/i.test(String(ev.message))) return;
    // 跨域脚本错误（浏览器脱敏为「Script error.」且不带文件名/行号，如 @ :0:0）：
    // 零诊断信息、无法定位也无法处理，属于纯噪音（跨源 iframe/WebView/三方脚本常见），
    // 不再进错误中心——否则会以「未捕获异常」常驻列表赶不走
    const msg = String(ev.message || '').trim();
    if (/^script error\.?$/i.test(msg) && (!ev.filename || !ev.lineno)) return;
    reportError('未捕获异常', `${String(ev.message || '').slice(0, 800)}\n@ ${String(ev.filename || '')}:${ev.lineno || 0}:${ev.colno || 0}`, 'global');
  };
  const onRej = (ev: PromiseRejectionEvent) => {
    reportError('未处理的 Promise 异常', errorText(ev.reason).slice(0, 800) || '(无详情)', 'global');
  };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);
  return () => {
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
  };
}
