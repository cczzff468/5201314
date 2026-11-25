'use client';

/**
 * AI 系统感知工具包（第二十九轮「AI 系统感知工具包 + AI 专属分屏浏览器」配套）。
 *
 * 三件套：剪贴板 / 手电筒 / 网络状态。
 * 1. 工具能力（Function Calling）：getClipboard / toggleFlashlight / getNetworkState
 *    （web-tools.ts 的执行器调用本模块的 readClipboard / setFlashlight / readNetworkState）
 * 2. System Prompt 注入：buildSystemPerceptionBlock() 把三件套的当前值 + AI 分屏浏览器的
 *    当前页面状态注入 system —— AI 结合【人设+记忆+当前上下文】自然地使用这些感知，
 *    而不是只在被问到时才查。
 *
 * 数据口径：
 * - 剪贴板：navigator.clipboard.readText()（需授权；WebView/HTTPS 才可用）。读取结果缓存在
 *   模块级 lastClipboard（带时间戳），system prompt 注入最近一次读取内容——AI 能「想起」
 *   你复制过什么。读取失败静默记为不可用（提示 AI 引导用户手动粘贴）。
 * - 手电筒：复用 hardware-torch.ts 的 Torch API（真机 WebView 才有；网页环境降级为
 *   「锁屏手电筒」同款模拟态）。状态缓存在模块级，供 prompt 注入。
 * - 网络：navigator.connection（effectiveType/downlink/type/saveData）+ navigator.onLine
 *   → 人类可读的「WiFi/4G/5G + 信号强弱」描述。
 */

import { aiBrowserSnapshot } from './ai-browser-store';
import { enableHardwareTorch, disableHardwareTorch } from './hardware-torch';

/* ---------------- 剪贴板 ---------------- */

export interface ClipboardSnapshot {
  ok: boolean;
  text: string;
  at: number;
  error?: string;
}

let lastClipboard: ClipboardSnapshot | null = null;

/** 读取系统剪贴板（授权失败/环境不支持返回 ok:false + 原因；成功则缓存） */
export async function readClipboard(): Promise<ClipboardSnapshot> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    return { ok: false, text: '', at: Date.now(), error: '当前环境不支持读取剪贴板' };
  }
  try {
    // WebView 里 readText 首次调用会弹系统授权框
    const text = await navigator.clipboard.readText();
    const snap: ClipboardSnapshot = { ok: true, text: text.slice(0, 500), at: Date.now() };
    lastClipboard = snap;
    return snap;
  } catch (e) {
    return {
      ok: false,
      text: '',
      at: Date.now(),
      error: /denied|NotAllowed/i.test(String(e))
        ? '剪贴板读取权限被拒绝'
        : '剪贴板读取失败（需要点击页面后授权）',
    };
  }
}

/** 最近一次成功读取的剪贴板内容（无 → null） */
export function cachedClipboard(): ClipboardSnapshot | null {
  return lastClipboard;
}

/* ---------------- 手电筒 ---------------- */

export interface FlashlightSnapshot {
  on: boolean;
  available: boolean;
  real: boolean;
}

/** 模块级手电筒状态（真机 Torch API 成功后才置 true；跨组件/跨轮次共享） */
let flashlightOn = false;
let flashlightReal = false;

/** 开/关手电筒（真机 Torch API：开 = enableHardwareTorch，关 = disableHardwareTorch；
 *  网页/无闪光灯环境返回不可用，AI 引导用户用锁屏手电筒按钮） */
export async function setFlashlight(on: boolean): Promise<FlashlightSnapshot> {
  if (!on) {
    disableHardwareTorch();
    flashlightOn = false;
    return { on: false, available: true, real: flashlightReal };
  }
  try {
    const res = await enableHardwareTorch();
    if (res.ok) {
      flashlightOn = true;
      flashlightReal = true;
      return { on: true, available: true, real: true };
    }
    return { on: false, available: false, real: false };
  } catch {
    return { on: flashlightOn, available: flashlightOn, real: flashlightReal };
  }
}

/** 当前手电筒状态（prompt 注入用；读模块缓存） */
export function readFlashlight(): FlashlightSnapshot {
  return { on: flashlightOn, available: flashlightOn, real: flashlightReal };
}

/* ---------------- 网络状态 ---------------- */

export interface NetworkSnapshot {
  online: boolean;
  kind: string; // WiFi / 4G / 5G / 未知
  strength: string; // 信号强/中/弱/未知
  raw: { effectiveType?: string; downlink?: number; type?: string; saveData?: boolean };
}

interface NetworkConnection extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  type?: string;
  saveData?: boolean;
}

function conn(): NetworkConnection | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: NetworkConnection }).connection ?? null;
}

/** 读取当前网络状态（WiFi/蜂窝 + 信号强弱估算） */
export function readNetworkState(): NetworkSnapshot {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const c = conn();
  const et = c?.effectiveType;
  const type = c?.type;
  let kind = '未知';
  if (!online) kind = '离线';
  else if (type === 'wifi' || type === 'ethernet') kind = 'WiFi';
  else if (type === 'cellular') kind = et === '4g' ? '4G/5G 蜂窝' : et === '3g' ? '3G' : et === '2g' ? '2G' : '蜂窝网络';
  else if (et === '4g') kind = '4G/5G 蜂窝'; // WebView 常不填 type，按速率档推
  else if (et === '3g' || et === '2g') kind = et === '3g' ? '3G' : '2G';
  else kind = 'WiFi 或有线'; // online 且无蜂窝特征，默认宽带类
  const downlink = c?.downlink ?? 0;
  const strength =
    !online
      ? '无'
      : kind === 'WiFi 或有线' || kind === 'WiFi'
        ? downlink > 0
          ? downlink >= 10
            ? '信号很好'
            : downlink >= 2
              ? '信号良好'
              : '信号一般'
          : '未知'
        : downlink >= 5
          ? '信号强'
          : downlink >= 1.5
            ? '信号中'
            : downlink > 0
              ? '信号弱'
              : '未知';
  return { online, kind, strength, raw: { effectiveType: et, downlink: c?.downlink, type, saveData: c?.saveData } };
}

/* ---------------- System Prompt 注入块 ---------------- */

/**
 * 构建「系统感知」system 注入块（chat.tsx baseSys 调用，perceptionBlock 旁边注入）。
 * 内容：网络状态 + 手电筒 + 剪贴板最近内容 + AI 分屏浏览器当前页面（AI 可视化感知）。
 * 空数据项自动省略；全部无数据时返回空串（零 token）。
 */
export function buildSystemPerceptionBlock(): string {
  const lines: string[] = [];

  // 网络
  try {
    const net = readNetworkState();
    lines.push(`- 网络状态：${net.kind}（${net.strength}${net.raw.saveData ? '，省流量模式开启' : ''}）`);
  } catch {
    /* 忽略 */
  }

  // 手电筒
  try {
    const fl = readFlashlight();
    if (fl.on) {
      lines.push('- 手电筒：开着（可用 toggleFlashlight 工具关掉）');
    } else {
      lines.push('- 手电筒：关着（可用 toggleFlashlight 工具打开；网页环境无真机闪光灯时会失败）');
    }
  } catch {
    /* 忽略 */
  }

  // 剪贴板（最近一次读取的内容；过期 30 分钟不注入）
  const clip = cachedClipboard();
  if (clip?.ok && clip.text && Date.now() - clip.at < 30 * 60_000) {
    const preview = clip.text.replace(/\s+/g, ' ').slice(0, 120);
    lines.push(`- 剪贴板最近内容：「${preview}」（可用 getClipboard 工具重新读取）`);
  }

  // AI 分屏浏览器（AI 感知网页加载位置）
  const br = aiBrowserSnapshot();
  if (br?.open) {
    lines.push(
      `- 分屏浏览器：正打开着${br.title ? `「${br.title.slice(0, 40)}」` : '一个网页'}（${
        br.mode === 'reader' ? '阅读模式' : '网页模式'
      }，${br.url.slice(0, 80)}）`,
    );
  }

  if (lines.length === 0) return '';
  return [
    '【系统感知】你此刻能感知到机主手机的这些实时状态（结合你的人设、记忆和当前聊天上下文自然地使用；不要机械复述）：',
    ...lines,
    '涉及实时状态的问题优先参考上面的数据；数据不足时可调用 getClipboard / toggleFlashlight / getNetworkState 工具现场读取。',
  ].join('\n');
}

/** 预热（发送消息时 fire-and-forget 调用：把剪贴板权限预热好，下一轮 prompt 即有数据） */
export async function prewarmSystemPerception(): Promise<void> {
  void readClipboard().catch(() => undefined);
}
