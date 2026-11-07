'use client';

/**
 * APP 更新检查（v1.4.2）：客户端状态与指纹比对逻辑。
 *
 * 链路：PhoneShell 开机完成后（AppUpdateDialog 延迟数秒）或设置 › APP 更新 页手动触发 →
 * fetch /api/app-version → 与 localStorage「上次见过的指纹」比对 →
 * 不同即「有新版」：全局弹窗提示（apkReady 才自动弹）/ 设置页红点。
 *
 * 「已见过」的写入时机（同口径，写后同一版本不再骚扰）：
 *  - 首次进入（无记录）：直接记为当前指纹，不弹（刚装完/刚清数据不打扰）；
 *  - 弹窗点「立即更新」或「下次再说」：记为当前指纹；
 *  - 设置页下载按钮：记为当前指纹。
 * 服务端 bump 版本或重放 APK → 指纹变化 → 下一轮检查再次提示。
 */

import { create } from 'zustand';
import type { AppReleaseNote } from '@/lib/app-version';

export interface AppUpdateInfo {
  version: string;
  code: number;
  notes: AppReleaseNote[];
  apkReady: boolean;
  apkSize: number | null;
  apkMtime: number | null;
  fingerprint: string;
}

interface AppUpdateState {
  /** 最新清单（fetch 成功后更新） */
  info: AppUpdateInfo | null;
  checking: boolean;
  /** 最近一次检查的错误（设置页展示；自动检查失败静默——不打扰开机） */
  error: string | null;
  /** 当前是否有新版未处理（指纹与已见记录不同；设置页红点/状态用） */
  hasUpdate: boolean;
  /** 全局弹窗是否打开 */
  promptOpen: boolean;
}

interface AppUpdateActions {
  /**
   * 拉取清单并比对指纹。
   * @param manual true = 设置页手动检查（失败写入 error、不自动弹窗）
   * @returns 是否有新版（null = 检查失败）
   */
  check: (manual: boolean) => Promise<boolean | null>;
  /** 弹窗「下次再说」/下载后：指纹记为已见过 + 关弹窗 */
  dismiss: () => void;
}

const SEEN_KEY = 'app-update-seen-v1';
/** 重复检查节流（内存级）：同页会话 60s 内不重复请求 */
const CHECK_THROTTLE_MS = 60_000;
let lastCheckAt = 0;

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(fp: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, fp);
  } catch {
    /* 隐私模式写入失败：本次会话内不再弹即可 */
  }
}

export const useAppUpdate = create<AppUpdateState & AppUpdateActions>((set, get) => ({
  info: null,
  checking: false,
  error: null,
  hasUpdate: false,
  promptOpen: false,

  check: async (manual) => {
    const now = Date.now();
    if (get().checking) return null;
    // 节流：非手动且 60s 内刚查过（info 还在）直接复用结论
    if (!manual && now - lastCheckAt < CHECK_THROTTLE_MS && get().info) {
      const fp = get().info?.fingerprint ?? '';
      return readSeen() !== fp;
    }
    lastCheckAt = now;
    set({ checking: true, ...(manual ? { error: null } : {}) });
    try {
      const res = await fetch('/api/app-version', { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as Partial<AppUpdateInfo> | null;
      if (!res.ok || !data || typeof data.version !== 'string' || typeof data.fingerprint !== 'string') {
        throw new Error(`HTTP ${res.status}`);
      }
      const info: AppUpdateInfo = {
        version: data.version,
        code: Number(data.code) || 0,
        notes: Array.isArray(data.notes) ? data.notes : [],
        apkReady: data.apkReady === true,
        apkSize: typeof data.apkSize === 'number' ? data.apkSize : null,
        apkMtime: typeof data.apkMtime === 'number' ? data.apkMtime : null,
        fingerprint: data.fingerprint,
      };
      const seen = readSeen();
      if (seen === null) {
        // 首次进入：记为当前指纹，不提示
        writeSeen(info.fingerprint);
        set({ info, checking: false, error: null, hasUpdate: false });
        return false;
      }
      const hasUpdate = seen !== info.fingerprint;
      set({
        info,
        checking: false,
        error: null,
        hasUpdate,
        // 自动模式且有新版且 APK 在位才弹窗（手动模式由设置页自己展示状态）
        ...(manual ? {} : { promptOpen: hasUpdate && info.apkReady }),
      });
      return hasUpdate;
    } catch {
      set({ checking: false, ...(manual ? { error: '检查更新失败，请稍后重试' } : {}) });
      return null;
    }
  },

  dismiss: () => {
    const fp = get().info?.fingerprint;
    if (fp) writeSeen(fp);
    set({ promptOpen: false, hasUpdate: false });
  },
}));

/** 快照判断：当前是否有新版未处理（设置页红点用；响应式场景用 useAppUpdate 订阅 hasUpdate） */
export function hasPendingUpdate(): boolean {
  const { info } = useAppUpdate.getState();
  if (!info) return false;
  try {
    return window.localStorage.getItem(SEEN_KEY) !== info.fingerprint;
  } catch {
    return false;
  }
}

// E2E/联调探针（window.__appUpdate.getState() 读检查器状态；生产环境无害）
if (typeof window !== 'undefined') {
  (window as typeof window & { __appUpdate?: typeof useAppUpdate }).__appUpdate = useAppUpdate;
}
