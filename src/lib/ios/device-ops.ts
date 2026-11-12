'use client';

/**
 * 真机操作底座（v1.9.36：设置 › 权限给予 › AI 动手范围 选「真机」时启用）。
 *
 * v1.9.35 曾把真机操控全面退役（删了 shizuku-agent/shizuku-lab 两层）；
 * 机主 v1.9.36 需求恢复「AI 动手真机」可选——但多步 ReAct 规划层不再回来，
 * 这里只恢复「[手机操作:…] 标记」单步命令的执行底座（点按/滑动/输入/按键/
 * 拉起 App/强杀/截屏/只读探测），全部经 native-perception 仍保留的原生桥：
 *  - nativeShizukuExec（白名单 input/am/pm/monkey/dumpsys/media/wm…）
 *  - nativeShizukuScreencap / nativeInputChinese（中文输入引擎）
 *
 * Web 模式（默认）完全不经过本模块——shizuku-autonomy.executePhoneOp 里
 * 按 aiActionTarget 分流；本文件的每个函数都要求原生环境 + Shizuku 就绪。
 */

import {
  isNativePerception,
  nativeShizukuExec,
  nativeShizukuScreencap,
  nativeInputChinese,
  nativeRestoreIme,
  type ShizukuExecResult,
} from './native-perception';
import { useSettings } from './store';

export type DeviceOpResult = { ok: boolean; text: string };

/** 本 APP 包名（Shizuku shell 命令的权限主体） */
export const OWN_PKG = 'com.z.aiphone';

/** Shizuku 未就绪的统一文案（reason → 人话） */
function gateText(r: ShizukuExecResult | null): string {
  if (r === null) return '桥无响应（非原生环境或原生调用超时）';
  if (r.reason === 'shizuku-not-running') return 'Shizuku 未运行：先去 设置 › 权限给予 › 调试权限 激活 Shizuku（重启手机后需重新激活）';
  if (r.reason === 'shizuku-no-permission') return 'Shizuku 未授权：去 设置 › 权限给予 › 调试权限 点「去授权」';
  if (r.reason) return `Shizuku 通道失败：${r.reason}`;
  return 'Shizuku 通道失败';
}

/** 底座执行 → DeviceOpResult（空输出的动作命令报「已执行」） */
async function run(
  cmd: string[],
  opts: { mustContain?: string[]; maxLines?: number; timeoutMs?: number; doneText?: string; trim?: (out: string) => DeviceOpResult } = {},
): Promise<DeviceOpResult> {
  const r = await nativeShizukuExec(cmd, opts);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时；确认在 APP 里且 Shizuku 已运行）' };
  if (!r.ok) return { ok: false, text: gateText(r) };
  if (opts.trim) return opts.trim(r.out ?? '');
  const out = (r.out ?? '').trim();
  return out ? { ok: true, text: out } : { ok: true, text: opts.doneText ?? '已执行（无输出）' };
}

/** 前置检查：必须原生环境（浏览器里直接给可读话术，不浪费桥超时） */
export function requireDevice(): DeviceOpResult | null {
  if (!isNativePerception()) {
    return { ok: false, text: '当前在浏览器里，无法操控真机——请用 APP（APK）打开，或在 设置 › 权限给予 把 AI 动手范围切回「网站里面」' };
  }
  return null;
}

// ================= 动手（UI 级操作） =================

/** 点按坐标 */
export async function labTap(x: number, y: number): Promise<DeviceOpResult> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, text: '坐标不合法' };
  return run(['input', 'tap', String(Math.round(x)), String(Math.round(y))], { doneText: `已点按 (${Math.round(x)}, ${Math.round(y)})` });
}

/** 滑动 (x1,y1) → (x2,y2)，duration 毫秒 */
export async function labSwipe(x1: number, y1: number, x2: number, y2: number, duration = 300): Promise<DeviceOpResult> {
  return run(
    ['input', 'swipe', String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(Math.max(100, duration))],
    { doneText: `已滑动 (${x1},${y1})→(${x2},${y2})` },
  );
}

/** 按键（keycode 数字或名称） */
export async function labKey(keycode: number | string): Promise<DeviceOpResult> {
  return run(['input', 'keyevent', String(keycode)], { doneText: `已按按键 ${keycode}` });
}

/** 常用按键码（标记命令「按键:返回/主页/…」映射用） */
export const KEY_WORDS: Record<string, number> = {
  返回: 4,
  back: 4,
  主页: 3,
  home: 3,
  多任务: 187,
  切换: 187,
  appswitch: 187,
  回车: 66,
  enter: 66,
  删除: 67,
  del: 67,
  音量加: 24,
  volumeup: 24,
  音量减: 25,
  volumedown: 25,
  播放暂停: 85,
  playpause: 85,
  下一首: 87,
  next: 87,
  上一首: 88,
  previous: 88,
  亮屏: 224,
  wake: 224,
  熄屏: 26,
  sleep: 26,
};

/**
 * 输入文字：ASCII 走 input text（空格转义 %s）；中文走输入引擎
 * （nativeInputChinese：临时切 AdbImeService → 广播 commitText → 还原）。
 */
let originalIme: string | null = null;

export async function deviceInputText(text: string): Promise<DeviceOpResult> {
  const s = text.trim();
  if (!s) return { ok: false, text: '要输入的内容为空' };
  if (!/[^\x20-\x7E]/.test(s)) {
    const escaped = s.replace(/ /g, '%s');
    return run(['input', 'text', escaped], { doneText: `已输入：${s}` });
  }
  const r = await nativeInputChinese(s);
  if (r === null) return { ok: false, text: '输入失败：原生输入桥无响应（中文无法用 input text 直输，且 APP 壳可能过旧）' };
  if (r.ok === false) return { ok: false, text: `输入失败：${r.reason ?? 'inputChinese 未成功'}` };
  if (r.via === 'ime' && r.switched && r.currentIme) originalIme = r.currentIme;
  const viaText = r.via === 'ime' ? `输入法${r.switched ? '，已临时切换' : ''}` : 'input text';
  return { ok: true, text: `已输入（${viaText}）：${s}` };
}

/** 还原输入法（任务收尾时调用；多次调用幂等） */
export async function restoreIme(): Promise<void> {
  if (originalIme) {
    const ime = originalIme;
    originalIme = null;
    await nativeRestoreIme(ime);
  }
}

/** 拉起真机 App（monkey 按包名，免查 Activity 名） */
export async function labOpenApp(pkg: string): Promise<DeviceOpResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: `包名不合法（收到「${pkg}」，需要形如 com.tencent.mm）` };
  return run(['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], {
    doneText: `已拉起 ${pkg}`,
    trim: (out) => ({
      ok: !/aborted|Error/i.test(out),
      text: /aborted|Error/i.test(out) ? `拉起失败（未安装？）：${out.trim().slice(0, 200)}` : `已拉起 ${pkg}`,
    }),
  });
}

/** 强杀真机 App */
export async function labForceStop(pkg: string): Promise<DeviceOpResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: '包名不合法' };
  return run(['am', 'force-stop', pkg], { doneText: `已强杀 ${pkg}` });
}

// ================= 看见（只读探测） =================

/** 静默截屏：ok 时 text 为 dataURL（VLM 识屏/用户预览直接 <img>） */
export async function labScreencap(): Promise<DeviceOpResult & { image?: string }> {
  const r = await nativeShizukuScreencap();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && r.frame) return { ok: true, text: '截屏成功（免授权弹窗）', image: r.frame };
  if (r.reason === 'shizuku-not-running' || r.reason === 'shizuku-no-permission') {
    return { ok: false, text: gateText(r as ShizukuExecResult) };
  }
  return { ok: false, text: '截屏失败（可能命中 FLAG_SECURE 防截屏页面，或 Shizuku 服务异常）' };
}

/** 屏幕分辨率（wm size；滑动/识屏坐标换算用） */
export async function labScreenSize(): Promise<{ w: number; h: number } | null> {
  const r = await run(['wm', 'size']);
  const out = r.ok ? r.text : '';
  const ovr = /Override size:\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(out);
  const phys = /Physical size:\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(out);
  const m = ovr ?? phys;
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** 实时前台应用（dumpsys window 焦点行） */
export async function labForegroundApp(): Promise<DeviceOpResult> {
  return run(['dumpsys', 'window'], {
    mustContain: ['mCurrentFocus'],
    maxLines: 30,
    trim: (out) => {
      const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('mCurrentFocus')) ?? '';
      const m = /mCurrentFocus=Window\{[^ ]+ [^ ]+ ([\w.$]+)\/([^\s}]+)/.exec(line);
      if (m) return { ok: true, text: `前台应用：${m[1]}\n界面：${m[2]}` };
      return { ok: true, text: line || out.slice(0, 400) || '未取到焦点信息' };
    },
  });
}

/** 电量状态（dumpsys battery：电量/充电中/健康） */
export async function labBattery(): Promise<DeviceOpResult> {
  return run(['dumpsys', 'battery'], {
    maxLines: 40,
    trim: (out) => {
      const level = /level:\s*(\d+)/.exec(out)?.[1];
      const charging = /status:\s*2/.test(out);
      if (level === undefined) return { ok: true, text: out.slice(0, 300) };
      return { ok: true, text: `电量 ${level}%${charging ? '（充电中）' : ''}` };
    },
  });
}

/** 音量档位（media volume → streamMusic 档位） */
export async function labVolume(): Promise<DeviceOpResult> {
  return run(['media', 'volume', '--stream', '3', '--get'], {
    maxLines: 10,
    trim: (out) => {
      const m = /volume is\s*(\d+)/i.exec(out);
      return { ok: true, text: m ? `媒体音量档位：${m[1]}` : out.slice(0, 200) || '已查询' };
    },
  });
}

/** 调媒体音量（--set 档位） */
export async function labSetVolume(index: number): Promise<DeviceOpResult> {
  const v = Math.max(0, Math.min(15, Math.round(index)));
  return run(['media', 'volume', '--stream', '3', '--set', String(v)], { doneText: `媒体音量已调到 ${v}` });
}

/** 通知栏快照（最近通知的 App + 标题，noredact 需 shell 权限） */
export async function labNotificationSnapshot(): Promise<DeviceOpResult> {
  return run(['dumpsys', 'notification', '--noredact'], {
    maxLines: 2600,
    timeoutMs: 12_000,
    trim: (out) => {
      const rows: string[] = [];
      let curPkg = '';
      let title = '';
      for (const raw of out.split('\n')) {
        const l = raw.trim();
        const pm = /^package=([\w.]+)/.exec(l);
        if (pm) {
          if (curPkg && title) rows.push(`${curPkg}：${title}`);
          curPkg = pm[1];
          title = '';
          continue;
        }
        const tm = /^android.title=(.+)$/.exec(l);
        if (tm) title = tm[1].trim();
      }
      if (curPkg && title) rows.push(`${curPkg}：${title}`);
      if (rows.length === 0) return { ok: true, text: '通知栏没有可见通知' };
      return { ok: true, text: `最近通知：\n${rows.slice(-10).join('\n')}` };
    },
  });
}

// ================= 识屏（截屏 + VLM 视觉理解） =================

/**
 * 截屏交 VLM 分析（/api/phone-vision，识图模型走设置 › 识图模型 配置）：
 * 返回模型对屏幕的描述（界面/文字/可点元素及坐标）。识图未配置/超时抛错，
 * 调用方按「识屏不可用」降级（截屏本身已成功）。
 */
export async function visionAsk(image: string, ask: string, timeoutMs = 90_000): Promise<string> {
  const res = await fetch('/api/phone-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, ask, config: useSettings.getState().visionConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as { desc?: unknown; error?: unknown } | null;
  if (res.ok && data && typeof data.desc === 'string' && data.desc.trim()) return data.desc.trim();
  const msg = typeof data?.error === 'string' && data.error ? data.error : `屏幕分析请求失败（HTTP ${res.status}）`;
  throw new Error(msg);
}

/** 「看屏幕」完整链：静默截屏 → VLM 描述（识图失败时只报截屏成功） */
export async function labLookScreen(detailed: boolean): Promise<DeviceOpResult & { image?: string }> {
  const shot = await labScreencap();
  if (!shot.ok) return shot;
  try {
    const ask = detailed
      ? '详细描述真实手机屏幕内容：当前应用、界面布局、可见文字、可点元素及其大致位置（上/中/下/左/右）。如有可能给出关键元素的坐标（像素 x,y）。'
      : '描述当前真实手机屏幕内容（应用/界面/可见文字/可点元素）。';
    const desc = await visionAsk(shot.image ?? '', ask, 30_000);
    return { ok: true, text: desc, image: shot.image };
  } catch (e) {
    return {
      ok: true,
      text: `截屏成功（识屏不可用：${e instanceof Error ? e.message.slice(0, 100) : '识图服务异常'}；可在 设置 › 识图模型 配置后重试）`,
      image: shot.image,
    };
  }
}
