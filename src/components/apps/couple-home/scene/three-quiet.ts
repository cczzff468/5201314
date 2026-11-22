'use client';

/**
 * three r183 起 THREE.Clock 模块标记弃用（官方推荐 THREE.Timer），但 R3F 9.x
 * 内部仍然 `new THREE.Clock()` 建 useFrame 的 state.clock —— 每次进拾光小屋挂载
 * 3D 场景，浏览器控制台都会刷一条：
 *   THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
 *
 * 这是依赖内部的已知噪音（等 R3F 官方迁移 Timer 后可整体移除本模块）。
 * 处理方式：用 three 官方导出的 setConsoleFunction 挂一个透传过滤器——
 * 只吞掉这一条 Clock 弃用警告，其余 log/warn/error 原样放行，不打架不打扰。
 * 幂等：重复调用无副作用。
 */

import * as THREE from 'three';

/** 过滤目标：Clock 弃用警告的消息片段（three 的 warn 会自动加 THREE. 前缀） */
const CLOCK_DEPRECATED_SNIPPET = 'Clock: This module has been deprecated';

let installed = false;

export function silenceThreeClockWarn(): void {
  if (installed) return;
  installed = true;
  const setFn = THREE.setConsoleFunction;
  if (typeof setFn !== 'function') return; // 老 version three 无此 API：静默跳过
  setFn((type, message, ...params) => {
    if (type === 'warn' && typeof message === 'string' && message.includes(CLOCK_DEPRECATED_SNIPPET)) return;
    if (type === 'log') console.log(message, ...params);
    else if (type === 'error') console.error(message, ...params);
    else console.warn(message, ...params);
  });
}
