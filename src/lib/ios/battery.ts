'use client';

import { useSyncExternalStore } from 'react';

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface BatteryInfo {
  level: number;
  charging: boolean;
}

const BATTERY_CACHE_KEY = 'ios-battery-cache';

// ---------------- 模块级 battery 状态（外部系统，多组件共享一份） ----------------

let batteryState: BatteryInfo | null = null;
let cacheRead = false;
const listeners = new Set<() => void>();
let batteryApiStarted = false;
let currentBattery: BatteryLike | null = null;

/** 首次同步读取 localStorage 缓存（客户端渲染期间调用，绘制前生效 → 电量图标不闪断） */
function readCacheOnce(): void {
  if (cacheRead) return;
  cacheRead = true;
  try {
    const raw = window.localStorage.getItem(BATTERY_CACHE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { level?: unknown; charging?: unknown };
    if (typeof v.level === 'number' && v.level > 0 && v.level <= 100) {
      batteryState = { level: v.level as number, charging: v.charging === true };
    }
  } catch {
    /* 缓存不可用时静默 */
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** 接入 Battery Status API（首个订阅者出现时启动一次，真实值变化时写回缓存并广播） */
function startBatteryApi(): void {
  if (batteryApiStarted) return;
  batteryApiStarted = true;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof nav.getBattery !== 'function') return; // 不支持的浏览器保持缓存值/满格
  void nav
    .getBattery()
    .then((b) => {
      currentBattery = b;
      const apply = () => {
        if (!currentBattery) return;
        const next = { level: currentBattery.level * 100, charging: currentBattery.charging };
        batteryState = next;
        try {
          window.localStorage.setItem(BATTERY_CACHE_KEY, JSON.stringify(next));
        } catch {
          /* 存储不可用时静默 */
        }
        emit();
      };
      apply();
      b.addEventListener('levelchange', apply);
      b.addEventListener('chargingchange', apply);
    })
    .catch(() => undefined);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  startBatteryApi();
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): BatteryInfo | null {
  readCacheOnce();
  return batteryState;
}

function getServerSnapshot(): BatteryInfo | null {
  return null;
}

/**
 * 设备真实电量（Battery Status API），状态栏与锁屏小组件共用。
 * useSyncExternalStore 订阅模块级状态：localStorage 缓存在客户端首次渲染同步恢复
 * （首帧即显示上次电量），随后接入 Battery API 真实值——刷新页面电量图标不再消失一瞬间。
 */
export function useBattery(): BatteryInfo | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
