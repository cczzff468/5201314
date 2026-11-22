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
 * 横屏（视口宽>高）：机身不再旋转——第十八轮起横屏 = 去壳全屏（壳直接铺满
 * 视口、无圆角边框、无 transform），所有手势/命中检测都走天然轴向，
 * scale 恒为 1，无坐标换算。
 */
export const shellScale = { value: 1 };

/**
 * 视口坐标 → 指定元素「内部坐标系」（即该元素 CSS left/top 使用的坐标系）。
 *
 * 为什么需要：App 内浮层（书源 ⋮ 菜单 / 阅读器划线手柄等）用 absolute 定位，
 * left/top 是元素内部坐标；而点击事件的 clientX/Y 与 getBoundingClientRect
 * 是视口坐标。机身带 transform（桌面竖屏缩放）时两者不再相等：
 *   local = (viewport - 壳原点) / scale
 * rect 传「定位参考元素」（浮层的定位父级或全屏根）的 getBoundingClientRect。
 */
export function viewportToLocal(vx: number, vy: number, rect: DOMRect): { x: number; y: number } {
  const s = shellScale.value || 1;
  return { x: (vx - rect.left) / s, y: (vy - rect.top) / s };
}

/** 元素内部坐标系的宽高（÷ 缩放；横屏全屏无缩放时即包围盒本身） */
export function localSizeOf(rect: DOMRect): { w: number; h: number } {
  const s = shellScale.value || 1;
  return { w: rect.width / s, h: rect.height / s };
}
