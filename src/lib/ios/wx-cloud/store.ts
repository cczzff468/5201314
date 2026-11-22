'use client';

/**
 * 微信云端助手 · 部署状态中心（用户自己的 Supabase）。
 *
 * 持久化：kv 'wx-cloud-state'（AES-GCM 密文——里面含 service_key / 管理 token / 模型 API key）。
 * 平台四选一：none（仅本机模式）/ supabase（一键部署）/ hf（已下架）/ clawcloud（已下架）。
 * v7 起 QQ/微信收发由内置 IM 网关承担（见 wx-cloud/gateway.ts），「腾讯云境内出口」已下架。
 */

import { create } from 'zustand';
import { ensureKvReady, kvGet, kvSet, kvDel } from '../idb-kv';
import { decryptSecret, encryptSecret, isEncrypted } from '../secret-box';

// ---------------- 类型 ----------------

export type CloudPlatform = 'none' | 'supabase' | 'hf' | 'clawcloud';

export const PLATFORM_LABELS: Record<CloudPlatform, string> = {
  none: '不使用云端（仅本机）',
  supabase: 'Supabase',
  hf: 'Hugging Face Spaces',
  clawcloud: 'ClawCloud Run',
};

export interface WxCloudSupabase {
  /** Supabase 管理 Access Token（一键部署用；密文留存便于后续更新，可清除） */
  token: string;
  ref: string;
  projectUrl: string;
  /** service_role key（读写运行包用；密文留存） */
  serviceKey: string;
  /** 定时任务密钥（cron 调用与测试用） */
  secret: string;
  deployedAt: number;
  /** 云端轮询开关（v6 恢复开关化，参照 ai-virtual-phone 交互）：开启 = 云端每分钟自动收发
   *  （微信 7×24 在线，无需开手机页面）；关闭 = 被动 Webhook（零轮询消耗）。
   *  缺省 = 存量状态（旧版本没写这个字段）：按「部署过即开着」推导。 */
  cronOn?: boolean;
}

export interface WxCloudHf {
  token: string;
  user: string;
  repo: string;
  deployedAt: number;
}

export interface WxCloudState {
  platform: CloudPlatform;
  supabase: WxCloudSupabase | null;
  hf: WxCloudHf | null;
  clawcloudAt: number | null;
  lastPing: { ok: boolean; msg: string; at: number } | null;
  /** v15 云端运行时代际（syncRunPackage 探测 ping ver 后写入；null = 没探过/探不到）。
   *  旧于 CLOUD_RUNTIME_VER 时真机上跑的还是旧函数行为（只回一两条/不会表情包/不会语音）。
   *  版本行在设置 → 云端助手展示，升级链在重新同步里自动完成 */
  lastRuntimeVer: number | null;
  /** 接入/换绑/断开微信/QQ、改「API 设置」后的后台自动同步结果（接入页 / API 设置页展示
   *  同步状态行用；channel 标记这条结果属于哪个页面，避免 QQ 的同步提示跑到微信接入页） */
  lastAutoSync: { ok: boolean; msg: string; at: number; channel?: 'qq' | 'wx' | 'api' } | null;
}

const STATE_KEY = 'wx-cloud-state';

function randomSecret(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

const DEFAULT_STATE: WxCloudState = {
  platform: 'none',
  supabase: null,
  hf: null,
  clawcloudAt: null,
  lastPing: null,
  lastRuntimeVer: null,
  lastAutoSync: null,
};

// ---------------- 持久化 ----------------

let memState: WxCloudState = DEFAULT_STATE;
let cloudReady = false;

async function persist(): Promise<void> {
  try {
    kvSet(STATE_KEY, await encryptSecret(JSON.stringify(memState)));
  } catch {
    /* secret-box 内部有降级 */
  }
}

function setAndPersist(patch: Partial<WxCloudState>): void {
  memState = { ...memState, ...patch };
  void persist();
  useWxCloud.setState(memState);
}

/** 同步读（供运行包构建等非 React 场景） */
export function wxCloudSnapshot(): WxCloudState {
  return memState;
}

/** 生成/复用定时任务密钥 */
export function ensureTaskSecret(): string {
  if (!memState.supabase?.secret) {
    const secret = randomSecret();
    setAndPersist({ supabase: { ...(memState.supabase ?? { token: '', ref: '', projectUrl: '', serviceKey: '', secret: '', deployedAt: 0 }), secret } });
    return secret;
  }
  return memState.supabase.secret;
}

// ---------------- Store ----------------

interface WxCloudStore extends WxCloudState {
  ready: boolean;
  boot: () => Promise<void>;
  setPlatform: (p: CloudPlatform) => void;
  saveSupabase: (v: WxCloudSupabase) => void;
  saveHf: (v: WxCloudHf) => void;
  markClawcloud: () => void;
  setLastPing: (p: { ok: boolean; msg: string } | null) => void;
  setLastRuntimeVer: (v: number | null) => void;
  setLastAutoSync: (p: { ok: boolean; msg: string; channel?: 'qq' | 'wx' | 'api' } | null) => void;
  clearPlatform: () => void;
}

export const useWxCloud = create<WxCloudStore>((set) => ({
  ...DEFAULT_STATE,
  ready: false,

  boot: async () => {
    if (cloudReady) return;
    cloudReady = true;
    try {
      await ensureKvReady();
      const raw = kvGet<string>(STATE_KEY);
      if (raw) {
        const plain = isEncrypted(raw) ? await decryptSecret(raw) : raw;
        const v = JSON.parse(plain) as Partial<WxCloudState>;
        memState = {
          ...DEFAULT_STATE,
          ...v,
        };
      }
      useWxCloud.setState({ ...memState, ready: true });
    } catch {
      useWxCloud.setState({ ready: true });
    }
  },

  setPlatform: (p) => setAndPersist({ platform: p }),

  saveSupabase: (v) => setAndPersist({ supabase: v }),

  saveHf: (v) => setAndPersist({ hf: v }),

  markClawcloud: () => setAndPersist({ clawcloudAt: Date.now() }),

  setLastPing: (p) => setAndPersist({ lastPing: p ? { ...p, at: Date.now() } : null }),

  setLastRuntimeVer: (v) => setAndPersist({ lastRuntimeVer: typeof v === 'number' ? v : null }),

  setLastAutoSync: (p) => setAndPersist({ lastAutoSync: p ? { ...p, at: Date.now() } : null }),

  clearPlatform: async () => {
    memState = { ...memState, supabase: null, hf: null, clawcloudAt: null, lastPing: null, lastAutoSync: null, platform: 'none' };
    await persist();
    useWxCloud.setState(memState);
  },
}));

/** 清空全部云端状态（断开云端用；kv 一并删除） */
export async function wipeWxCloud(): Promise<void> {
  memState = { ...DEFAULT_STATE, platform: 'none' };
  try {
    await kvDel(STATE_KEY);
  } catch {
    /* 忽略 */
  }
  useWxCloud.setState({ ...memState });
}
