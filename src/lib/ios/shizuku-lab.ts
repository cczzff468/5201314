'use client';

/**
 * Shizuku 能力实验室（v1.3）：在 nativeShizukuExec 底座上拼 argv + 解析输出，
 * 实现用户点单的全部「AI 动手 / AI 看见 / 自授权」能力。
 *
 * 分层：NativePerceptionPlugin.shizukuExec 只认白名单二进制；本文件负责——
 *  - 动手：input tap/swipe/text/keyevent · am start/force-stop · pm disable/enable/
 *    install/uninstall · monkey 拉起 · media dispatch/volume · svc wifi/data/bt
 *  - 看见：screencap（专用 AIDL 通道，服务端降采样）· dumpsys notification/
 *    window/media_session/battery/clipboard · content query 短信/通话 · logcat
 *  - 自授权：cmd appops set（使用情况）· cmd notification allow_listener（通知使用权）
 *
 * 全部返回统一的 { ok, text }（text 为给人看的结果行），UI 侧零解析负担。
 * 解析失败时降级返回原始输出片段（best-effort：国产 ROM dumpsys 格式差异大）。
 */

import {
  nativeShizukuExec,
  nativeShizukuScreencap,
  type ShizukuExecResult,
} from './native-perception';

export type LabResult = { ok: boolean; text: string };

/** 本 APP 包名（自授权命令用） */
const OWN_PKG = 'com.z.aiphone';

/** Shizuku 未就绪的统一文案（reason → 人话） */
function gateText(r: ShizukuExecResult | null): string {
  if (r === null) return '桥无响应（非原生环境或原生调用超时）';
  if (r.reason === 'shizuku-not-running') return 'Shizuku 未运行：先在 Shizuku APP 里激活（重启手机后需重新激活）';
  if (r.reason === 'shizuku-no-permission') return 'Shizuku 未授权：回感知设置页点「去授权」';
  if (r.reason) return `Shizuku 通道失败：${r.reason}`;
  return 'Shizuku 通道失败';
}

/** 底座执行 → LabResult（ok 且有输出带原文；空输出的动作命令报「已执行」） */
async function run(
  cmd: string[],
  opts: { mustContain?: string[]; maxLines?: number; timeoutMs?: number; doneText?: string; trim?: (out: string) => LabResult } = {},
): Promise<LabResult> {
  const r = await nativeShizukuExec(cmd, opts);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: gateText(r) };
  if (opts.trim) return opts.trim(r.out ?? '');
  const out = (r.out ?? '').trim();
  return out ? { ok: true, text: out } : { ok: true, text: opts.doneText ?? '已执行（无输出）' };
}

// ================= A. 让 AI 看见（只读探测） =================

/** 静默截屏：返回 { ok, text }，text 为 dataURL（UI 直接 <img>） */
export async function labScreencap(): Promise<LabResult & { image?: string }> {
  const r = await nativeShizukuScreencap();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && r.frame) return { ok: true, text: '截屏成功（免授权弹窗）', image: r.frame };
  if (r.reason === 'shizuku-not-running' || r.reason === 'shizuku-no-permission') {
    return { ok: false, text: gateText(r) };
  }
  return { ok: false, text: '截屏失败（可能命中 FLAG_SECURE 防截屏页面，或 Shizuku 服务异常）' };
}

/** 屏幕分辨率（wm size；识图坐标换算用，Override 优先于 Physical） */
export async function labScreenSize(): Promise<{ w: number; h: number } | null> {
  const r = await run(['wm', 'size']);
  const out = r.ok ? r.text : '';
  const ovr = /Override size:\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(out);
  const phys = /Physical size:\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(out);
  const m = ovr ?? phys;
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** 实时前台应用（dumpsys window 焦点行 → 包名 + Activity） */
export async function labForegroundApp(): Promise<LabResult> {
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

/** 通知栏快照（dumpsys notification --noredact → 最近通知的 App + 文本） */
export async function labNotificationSnapshot(): Promise<LabResult> {
  return run(['dumpsys', 'notification', '--noredact'], {
    maxLines: 2600,
    timeoutMs: 12_000,
    trim: (out) => {
      const rows: string[] = [];
      let curPkg = '';
      let title = '';
      for (const raw of out.split('\n')) {
        const line = raw.trim();
        const p = /NotificationRecord\(.*?\|([\w.]+)\|/.exec(line);
        if (p) {
          curPkg = p[1];
          title = '';
          continue;
        }
        const t = /android\.title=(.*)/.exec(line);
        if (t) {
          title = t[1].trim();
          continue;
        }
        const b = /android\.text=(.*)/.exec(line);
        if (b && curPkg) {
          const text = b[1].trim().slice(0, 120);
          rows.push(`${curPkg}${title ? `「${title.slice(0, 60)}」` : ''}：${text}`);
          if (rows.length >= 30) break;
        }
      }
      if (rows.length === 0) {
        return out.trim()
          ? { ok: true, text: `（未解析出行结构，原始片段）\n${out.trim().slice(0, 800)}` }
          : { ok: true, text: '通知栏为空（或本机 ROM 拦截 --noredact）' };
      }
      return { ok: true, text: `通知栏快照（最近 ${rows.length} 条）：\n${rows.join('\n')}` };
    },
  });
}

/** 正在播放的媒体（dumpsys media_session → 活跃会话 + 播放态） */
export async function labNowPlaying(): Promise<LabResult> {
  return run(['dumpsys', 'media_session'], {
    maxLines: 1600,
    trim: (out) => {
      const lines = out.split('\n').map((l) => l.trim());
      const interesting = lines.filter((l) =>
        /state=\d|pkg=|description=|MediaSessionRecord|active=|title/i.test(l),
      ).slice(0, 40);
      if (interesting.length === 0) return { ok: true, text: '当前没有活跃的媒体会话' };
      return { ok: true, text: interesting.join('\n').slice(0, 1200) };
    },
  });
}

/** 电量状态（dumpsys battery → 电量/是否充电/健康） */
export async function labBattery(): Promise<LabResult> {
  return run(['dumpsys', 'battery'], {
    maxLines: 160,
    trim: (out) => {
      const level = /level:\s*(\d+)/.exec(out)?.[1];
      const status = /status:\s*(\d+)/.exec(out)?.[1];
      if (!level) return { ok: true, text: out.trim().slice(0, 600) || '未取到电量' };
      const statusMap: Record<string, string> = {
        '2': '充电中 ⚡', '3': '使用电池', '4': '已充满/未在充', '5': '已充满',
      };
      const st = status ? (statusMap[status] ?? `状态码${status}`) : '';
      return { ok: true, text: `电量：${level}%${st ? `（${st}）` : ''}` };
    },
  });
}

/** 剪贴板内容（dumpsys clipboard → best-effort） */
export async function labClipboard(): Promise<LabResult> {
  return run(['dumpsys', 'clipboard'], {
    maxLines: 140,
    trim: (out) => {
      const m = /text=(.+?)(\s*$|\n|\})/m.exec(out);
      if (m && m[1].trim()) return { ok: true, text: `剪贴板：${m[1].trim().slice(0, 200)}` };
      const clip = /Primary clip[:\s]*(.+)/.exec(out)?.[1];
      if (clip) return { ok: true, text: `剪贴板：${clip.trim().slice(0, 200)}` };
      return { ok: true, text: out.trim() ? `（原始输出）\n${out.trim().slice(0, 500)}` : '剪贴板为空（或本机 ROM 不显示）' };
    },
  });
}

/** 短信收件箱（content query → 最近 N 条：号码 + 内容） */
export async function labSmsInbox(limit = 10): Promise<LabResult> {
  return run(
    ['content', 'query', '--uri', 'content://sms/inbox', '--projection', 'address:body:date', '--sort', 'date DESC'],
    {
      maxLines: Math.max(40, limit * 4),
      trim: (out) => {
        const rows: string[] = [];
        for (const raw of out.split('\n')) {
          const line = raw.trim();
          if (!line.startsWith('Row:')) continue;
          const addr = /address=(.*?)(,|\s*$)/.exec(line)?.[1] ?? '';
          const body = /body=(.*)$/.exec(line)?.[1] ?? '';
          if (addr || body) rows.push(`${addr || '未知号码'}：${body.slice(0, 80)}`);
          if (rows.length >= limit) break;
        }
        if (rows.length === 0) {
          return out.trim()
            ? { ok: false, text: `未能读取短信（本机 ROM 可能拦截 content query）。原始片段：\n${out.trim().slice(0, 300)}` }
            : { ok: false, text: '未读到短信（空结果：ROM 拦截或收件箱为空）' };
        }
        return { ok: true, text: `最近 ${rows.length} 条短信：\n${rows.join('\n')}` };
      },
    },
  );
}

/** 通话记录（content query → 最近 N 条：姓名/号码/时长） */
export async function labCallLog(limit = 10): Promise<LabResult> {
  return run(
    ['content', 'query', '--uri', 'content://call_log/calls', '--projection', 'name:number:duration:date', '--sort', 'date DESC'],
    {
      maxLines: Math.max(40, limit * 4),
      trim: (out) => {
        const rows: string[] = [];
        for (const raw of out.split('\n')) {
          const line = raw.trim();
          if (!line.startsWith('Row:')) continue;
          const name = /name=(.*?)(,|\s*$)/.exec(line)?.[1] ?? '';
          const number = /number=(.*?)(,|\s*$)/.exec(line)?.[1] ?? '';
          const dur = /duration=(\d+)/.exec(line)?.[1] ?? '?';
          if (number) rows.push(`${name || number}${name ? `(${number})` : ''} · ${dur}秒`);
          if (rows.length >= limit) break;
        }
        if (rows.length === 0) {
          return out.trim()
            ? { ok: false, text: `未能读取通话记录（ROM 可能拦截）。原始片段：\n${out.trim().slice(0, 300)}` }
            : { ok: false, text: '未读到通话记录（空结果：ROM 拦截或无记录）' };
        }
        return { ok: true, text: `最近 ${rows.length} 条通话：\n${rows.join('\n')}` };
      },
    },
  );
}

/** 系统日志（logcat -d 最近 N 行；排查真机 bug 用） */
export async function labLogcat(lines = 200): Promise<LabResult> {
  return run(['logcat', '-d', '-t', String(Math.min(2000, Math.max(20, lines))), '-v', 'time'], {
    maxLines: Math.min(2100, lines + 60),
    timeoutMs: 12_000,
    trim: (out) => {
      const ls = out.trim();
      return ls ? { ok: true, text: ls.slice(-6000) } : { ok: true, text: '日志为空' };
    },
  });
}

/** 屏幕分辨率（wm size；滑动手势坐标计算用） */
export async function labScreenSize(): Promise<{ w: number; h: number } | null> {
  const r = await nativeShizukuExec(['wm', 'size'], { maxLines: 10 });
  if (!r?.ok) return null;
  const m = /(?:Override|Physical) size:\s*(\d+)x(\d+)/.exec(r.out ?? '');
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** 已安装应用列表（pm list packages；可按关键词过滤，AI 自主找包名用） */
export async function labPackageList(filter?: string): Promise<LabResult> {
  return run(['pm', 'list', 'packages'], {
    maxLines: 2600,
    timeoutMs: 10_000,
    trim: (out) => {
      const pkgs = out
        .split('\n')
        .map((l) => l.trim().replace(/^package:/, ''))
        .filter(Boolean);
      if (pkgs.length === 0) return { ok: false, text: '未取到应用列表（pm list 无输出）' };
      const kw = filter?.trim().toLowerCase();
      const hit = kw ? pkgs.filter((p) => p.toLowerCase().includes(kw)) : pkgs;
      if (hit.length === 0) return { ok: true, text: `手机装了 ${pkgs.length} 个应用，没有包名含「${filter}」的（换关键词或查全部）` };
      const head = `手机共 ${pkgs.length} 个应用${kw ? `，包名含「${filter}」的 ${hit.length} 个` : ''}`;
      return { ok: true, text: `${head}：\n${hit.slice(0, 40).join('\n')}${hit.length > 40 ? `\n…（共${hit.length}个，加关键词缩小范围）` : ''}` };
    },
  });
}

// ================= B. 让 AI 动手（真实操作手机） =================

/** 点按 (x, y) */
export async function labTap(x: number, y: number): Promise<LabResult> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, text: '坐标不合法' };
  return run(['input', 'tap', String(Math.round(x)), String(Math.round(y))], { doneText: `已点按 (${Math.round(x)}, ${Math.round(y)})` });
}

/** 滑动 (x1,y1) → (x2,y2)，duration 毫秒 */
export async function labSwipe(x1: number, y1: number, x2: number, y2: number, duration = 300): Promise<LabResult> {
  return run(
    ['input', 'swipe', String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(Math.max(100, duration))],
    { doneText: `已滑动 (${x1},${y1})→(${x2},${y2})` },
  );
}

/**
 * 输入文字（input text 只支持 ASCII；空格需转义为 %s —— 中文输入是系统限制，
 * 提示走剪贴板方案）。返回 ok=false 时说明原因。
 */
export async function labInputText(text: string): Promise<LabResult> {
  if (!text) return { ok: false, text: '要输入的内容为空' };
  if (/[^\x20-\x7E]/.test(text)) {
    return { ok: false, text: 'input text 只支持英文数字符号（系统限制）；中文需输入法或剪贴板方案' };
  }
  const escaped = text.replace(/ /g, '%s');
  return run(['input', 'text', escaped], { doneText: `已输入：${text}` });
}

/** 按键（keycode 数字或名称） */
export async function labKey(keycode: number | string): Promise<LabResult> {
  return run(['input', 'keyevent', String(keycode)], { doneText: `已按按键 ${keycode}` });
}

/** 常用按键码（UI 快捷按钮用） */
export const KEY_CODES = {
  back: 4,
  home: 3,
  appSwitch: 187,
  volumeUp: 24,
  volumeDown: 25,
  enter: 66,
  del: 67,
  mediaPlayPause: 85,
  mediaNext: 87,
  mediaPrevious: 88,
} as const;

/** 打开 App（monkey 按包名拉起启动页，免查 Activity 名） */
export async function labOpenApp(pkg: string): Promise<LabResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: '包名不合法' };
  return run(['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], {
    doneText: `已拉起 ${pkg}`,
    trim: (out) => ({ ok: !/aborted|Error/i.test(out), text: /aborted|Error/i.test(out) ? `拉起失败（未安装？）：${out.trim().slice(0, 200)}` : `已拉起 ${pkg}` }),
  });
}

/** 打开网址（am start VIEW；仅允许 http/https） */
export async function labOpenUrl(url: string): Promise<LabResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, text: '只支持 http/https 链接' };
  return run(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url], {
    doneText: `已请求打开：${url}`,
    trim: (out) => ({
      ok: /Starting:|Status: ok|Error type 3|Warning: Activity/.test(out) ? true : true,
      text: out.trim().includes('Error')
        ? `打开失败：${out.trim().split('\n').filter((l) => /Error|error/.test(l)).slice(0, 3).join('；').slice(0, 200)}`
        : `已请求打开：${url}`,
    }),
  });
}

/** 强杀 App（am force-stop） */
export async function labForceStop(pkg: string): Promise<LabResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: '包名不合法' };
  return run(['am', 'force-stop', pkg], { doneText: `已强杀 ${pkg}` });
}

/** 冻结 / 解冻 App（pm disable-user --user 0 / pm enable；冻结可逆、数据保留） */
export async function labSetAppFrozen(pkg: string, freeze: boolean): Promise<LabResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: '包名不合法' };
  const cmd = freeze
    ? ['pm', 'disable-user', '--user', '0', pkg]
    : ['pm', 'enable', pkg];
  return run(cmd, {
    doneText: freeze ? `已冻结 ${pkg}（桌面图标消失，解冻即恢复）` : `已解冻 ${pkg}`,
    trim: (out) => {
      const bad = /Error|Unknown|Failed/i.test(out);
      return { ok: !bad, text: bad ? `操作失败：${out.trim().slice(0, 200)}` : (freeze ? `已冻结 ${pkg}` : `已解冻 ${pkg}`) };
    },
  });
}

/** 静默安装 APK（pm install -r；path 为手机上的本地路径） */
export async function labInstallApk(path: string): Promise<LabResult> {
  if (!/^\/[\w./ -]+$/.test(path)) return { ok: false, text: '路径不合法（需以 / 开头的手机本地路径）' };
  return run(['pm', 'install', '-r', path], {
    timeoutMs: 30_000,
    trim: (out) => {
      const ok = /Success/.test(out);
      return { ok, text: ok ? `安装成功：${path}` : `安装失败：${out.trim().slice(0, 400)}` };
    },
  });
}

/** 卸载 App（pm uninstall --user 0：仅当前用户移除，可恢复、数据保留） */
export async function labUninstall(pkg: string): Promise<LabResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: '包名不合法' };
  return run(['pm', 'uninstall', '--user', '0', pkg], {
    trim: (out) => {
      const ok = /Success/.test(out);
      return { ok, text: ok ? `已卸载 ${pkg}（--user 0 可恢复）` : `卸载失败：${out.trim().slice(0, 300)}` };
    },
  });
}

/** 媒体按键（media dispatch：play-pause/next/previous/play/pause） */
export async function labMediaKey(name: 'play-pause' | 'next' | 'previous' | 'play' | 'pause'): Promise<LabResult> {
  return run(['media', 'dispatch', `media-${name}`], { doneText: `已发送媒体指令：${name}` });
}

/** 音量调节（media volume：adj raise/lower/mute 或 set 0~15） */
export async function labVolume(action: 'raise' | 'lower' | 'mute' | number): Promise<LabResult> {
  const cmd = typeof action === 'number'
    ? ['media', 'volume', '--show', '--stream', '3', '--set', String(Math.max(0, Math.min(15, action)))]
    : ['media', 'volume', '--show', '--stream', '3', '--adj', action];
  return run(cmd, { doneText: typeof action === 'number' ? `音量已设为 ${action}` : `已${action === 'raise' ? '调高' : action === 'lower' ? '调低' : '静音'}音量` });
}

/** 网络开关（svc wifi/data/bluetooth enable|disable） */
export async function labSvc(what: 'wifi' | 'data' | 'bluetooth', on: boolean): Promise<LabResult> {
  const nameMap = { wifi: 'Wi-Fi', data: '移动流量', bluetooth: '蓝牙' } as const;
  return run(['svc', what, on ? 'enable' : 'disable'], {
    doneText: `已${on ? '开启' : '关闭'}${nameMap[what]}（部分 ROM 需 root 才生效，以实际为准）`,
    trim: (out) => {
      const bad = /Error|Failed|not found/i.test(out);
      return { ok: !bad, text: bad ? `操作失败：${out.trim().slice(0, 200)}` : `已${on ? '开启' : '关闭'}${nameMap[what]}` };
    },
  });
}

// ================= C. 一键自授权（免设置页翻菜单） =================

/** 自授予「有权查看使用情况」（cmd appops set；效果 = 系统设置里手动开） */
export async function labSelfGrantUsage(): Promise<LabResult> {
  return run(['cmd', 'appops', 'set', OWN_PKG, 'GET_USAGE_STATS', 'allow'], {
    doneText: '已自授予「使用情况」权限（无需去系统设置）',
    trim: (out) => {
      const bad = /Error|Exception|Unknown/i.test(out);
      return { ok: !bad, text: bad ? `自授权失败：${out.trim().slice(0, 250)}` : '已自授予「使用情况」权限' };
    },
  });
}

/** 自授予「通知使用权」（cmd notification allow_listener；读歌名用） */
export async function labSelfGrantNotificationListener(): Promise<LabResult> {
  const comp = `${OWN_PKG}/com.z.aiphone.MediaListenerService`;
  return run(['cmd', 'notification', 'allow_listener', comp], {
    doneText: '已自授予「通知使用权」（歌名感知免设置）',
    trim: (out) => {
      const bad = /Error|Exception|not allowed|Unknown/i.test(out);
      return { ok: !bad, text: bad ? `自授权失败：${out.trim().slice(0, 250)}` : '已自授予「通知使用权」' };
    },
  });
}
