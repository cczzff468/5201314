/**
 * 手机壳视觉缩放系数（模块级单例，PhoneShell 写、HomeScreen 读）。
 *
 * 桌面端（≥640px）机身固定 390×844，矮窗口（如预览面板）里底部会被裁掉——
 * 底部网格行与 Dock 看不见也摸不着，App「不能往下放了」。PhoneShell 按可用
 * 宽高把机身 transform: scale(s) 等比缩到正好放得下（内部布局仍按 390×844 计算）。
 *
 * 壳一旦带 transform 就成为 fixed 后代的包含块：fixed 子元素的 left/top 是
 * 「壳本地坐标」（缩放前坐标系）。HomeScreen 的拖拽浮动副本/飞入动画渲染在
 * fixed 层，命中检测用的却是视口坐标（clientX/Y 与 getBoundingClientRect，
 * 缩放下两者天然一致）——渲染前需把视口坐标换算成本地坐标：
 *   local = (viewport - 壳原点) / scale
 * WAAPI/FX 的 translate 像素增量（FLIP/落位/滑动跟手）同理 ÷ scale。
 * 移动端全屏恒为 1（换算后数值不变，代码单一路径）。
 *
 * rotated（横屏旋转）：视口为横屏（宽>高）时 PhoneShell 把机身旋转 90° 铺满视口，
 * 壳本地坐标系相对视口旋转了 90°——HomeScreen 的轻扫翻页等视口轴向手势需按
 * rotated 交换 x/y 轴（clientX↔clientY），其余命中检测走 getBoundingClientRect 天然正确。
 */
export const shellScale = { value: 1, rotated: false };

/**
 * 视口坐标 → 指定元素「内部坐标系」（即该元素 CSS left/top 使用的坐标系）。
 *
 * 为什么需要：App 内浮层（书源 ⋮ 菜单 / 阅读器划线手柄等）用 absolute 定位，
 * left/top 是元素内部坐标；而点击事件的 clientX/Y 与 getBoundingClientRect
 * 是视口坐标。机身带 transform（桌面缩放 / 横屏 rotate(90deg)）时两者不再相等：
 * - 竖屏缩放：local = (viewport - 壳原点) / scale
 * - 横屏旋转 90°（顺时针）：内部 CSS left 轴 → 视口 y 轴、内部 CSS top 轴 → 视口 -x 轴，
 *   且内部 (0,0) 位于视口包围盒的「右上角」：
 *     x_local = (vy - R.top) / s
 *     y_local = (R.right - vx) / s
 * rect 传「定位参考元素」（浮层的定位父级或全屏根）的 getBoundingClientRect。
 */
export function viewportToLocal(vx: number, vy: number, rect: DOMRect): { x: number; y: number } {
  const s = shellScale.value || 1;
  if (shellScale.rotated) {
    // rotate(90deg) 顺时针：内部左上角 → 视觉包围盒右上角。
    // 内部 CSS left（距左边）→ 视觉纵向：x_local = vy - R.top
    // 内部 CSS top（距顶边） → 视觉横向：y_local = R.right - vx
    // （实测校准：offsetTop/offsetLeft 与 getBoundingClientRect 四角完全吻合）
    return { x: (vy - rect.top) / s, y: (rect.right - vx) / s };
  }
  return { x: (vx - rect.left) / s, y: (vy - rect.top) / s };
}

/** 元素内部坐标系的宽高（横屏旋转时包围盒宽高互换再除以缩放） */
export function localSizeOf(rect: DOMRect): { w: number; h: number } {
  const s = shellScale.value || 1;
  return shellScale.rotated
    ? { w: rect.height / s, h: rect.width / s }
    : { w: rect.width / s, h: rect.height / s };
}
