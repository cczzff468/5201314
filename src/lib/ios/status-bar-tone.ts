import { useEffect, useSyncExternalStore } from 'react';

/**
 * 状态栏前景基调（屏幕级实时覆盖，第三十三轮）：
 * iOS 状态栏文字颜色应跟随「当前最上层界面」的背景明暗——深色背景白字、浅色背景黑字。
 * 全局判定（foreground.useLightForeground）只能按 App 静态声明/主题兜底，覆盖不到
 * App 内部页面切换（如音乐 App 白底首页/搜索/评论页 ⇄ 深色播放页）；
 * 本模块提供屏幕级基调栈：页面挂载时 push 自己的基调、卸载时 pop，
 * 状态栏永远读栈顶（后挂载的浮层优先，如评论页盖在播放页上）；空栈 = 无覆盖，
 * 消费方回落 App 静态声明/主题/壁纸判定（语义见 foreground.useLightForeground）。
 */

/** 'light' = 白色前景（身后深色背景）；'dark' = 黑色前景（身后浅色背景） */
export type StatusBarTone = 'light' | 'dark';

let seq = 0;
const stack = new Map<number, StatusBarTone>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** 压入基调（返回句柄供卸载时 pop） */
export function pushStatusBarTone(tone: StatusBarTone): number {
  const id = ++seq;
  stack.set(id, tone);
  emit();
  return id;
}

/** 弹出基调（幂等；句柄不存在时无副作用） */
export function popStatusBarTone(id: number): void {
  if (stack.delete(id)) emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): StatusBarTone | null {
  // Map 保持插入序：取最后压入的基调；空栈返回 null = 「当前没有页面级覆盖」，
  // 消费方（foreground.useLightForeground）回落到 App 静态声明/主题/壁纸逻辑。
  // （旧版空栈默认 'light' 会被 toneOverride 的 truthy 判断当成有效覆盖，
  //  把无自管基调的 App 钉死在白字——探针失效时浅色主题下白底白字不可读，Task 100-f 修）
  let last: StatusBarTone | null = null;
  for (const t of stack.values()) last = t;
  return last;
}

/** 读当前基调（状态栏 / 全局明暗判定用）；null = 无页面级覆盖 */
export function useStatusBarTone(): StatusBarTone | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** 页面级：挂载期间生效的基调（tone 变化即时切换，卸载自动恢复上一层） */
export function useStatusBarToneEffect(tone: StatusBarTone): void {
  useEffect(() => {
    const id = pushStatusBarTone(tone);
    return () => popStatusBarTone(id);
  }, [tone]);
}
