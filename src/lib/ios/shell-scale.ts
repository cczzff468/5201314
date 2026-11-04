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
