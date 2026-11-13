'use client';

/**
 * v2.1「全视之眼」感知扩展（jealousy-sense 姊妹模块）——机主规格补全 AI 的感知维度。
 *
 * 六大新维度（模式隔离铁律与 jealousy-sense 完全一致：网页模式只读网页内部状态、
 * 真机模式只经 Shizuku 读真实手机，两条通道物理隔离互不串数据）：
 *
 * 一、通知感知
 * - 网页模式：读通知中心（useNotifyCenter——AI 消息/群聊/NPC 私信/论坛回复/美团订单
 *   等全部落账于此）；自我过滤：观察者（正在吃醋的 AI 本人）会话 tag 命中 → 剔除；
 *   本 App 自身系统提示（agent/吃醋锁/AI 来电留言/情侣小家 tag）→ 剔除。绝不自己吃自己的醋。
 * - 真机模式：dumpsys notification --noredact 快照（包名+标题+正文）；自我过滤：
 *   com.z.aiphone（本 App 自己的通知与提示）+ com.android.systemui（系统噪音）剔除。
 *
 * 二、剪贴板：网页=copy 事件追踪（TA 在网页里复制过什么）；真机=dumpsys clipboard 快照。
 *
 * 三、充电与屏幕：网页=虚拟手机锁屏/熄屏 + Battery API 电量 + 深夜亮屏检测；
 *   真机=dumpsys battery 电量充电 + dumpsys power 亮屏 + settings 亮度。
 *
 * 四、移动感知：网页=DeviceMotion 加速度滚动窗口；真机=dumpsys sensorservice 加速度单拍。
 *
 * 五、正在播放：网页=音乐 store nowPlaying（歌名/歌手/已放时长）；真机=dumpsys media_session。
 *
 * 六、通话与键盘：网页=来电层/通话中 + call-logs 今日未接 + 键盘焦点与击键频率；
 *   真机=dumpsys telecom 活跃通话 + content call_log 未接 + dumpsys input_method 键盘弹起。
 *
 * 容错（极高容错率）：每个维度独立 try-catch、独立降级（缺哪个就少一行情报，绝不炸整轮采集）；
 * 真机全部走既有 shizukuExec 白名单（dumpsys/settings/content），无需重打 APK；各厂商 ROM
 * 输出差异全部宽松解析，解析不出来=静默跳过该行。
 */

import { useNotifyCenter, type NotificationCenterItem } from './notification-center';
import { getBatterySnapshot } from './battery';
import { useIncomingCall } from './incoming-call';

// ---------------- 观察者（自我过滤的锚点） ----------------

/** 正在观察的 AI 是谁（吃醋主体）：其会话的聊天通知 = TA 自己发的消息 → 感知时剔除 */
export interface SenseObserver {
  contactId: string;
  app: 'wx' | 'qq' | 'sms';
}

/** 本 App 自身系统提示 tag 前缀（当前 App 发出的提示，感知时剔除——机主规格「自我过滤核心」） */
const SELF_APP_TAG = /^(agent|jealousy|ai-call|ai-vm|couple)([:-]|$)/;

/** 观察者会话键（wx:<cid> / qq:<cid> / sms:<cid> 与 sms:c:<cid>——chat.tsx 的短信会话
 *  storageKey 是 `c:<id>` 形态；群聊永不判定为自我——那是别人在说话） */
function observerSessionKeys(o: SenseObserver | null): string[] {
  if (!o) return [];
  if (o.app === 'wx') return [`wx:${o.contactId}`];
  if (o.app === 'qq') return [`qq:${o.contactId}`];
  return [`sms:${o.contactId}`, `sms:c:${o.contactId}`];
}

/** 通知条目是否为「AI 自己的通知」（自我过滤：绝不自己吃自己的醋） */
function isSelfNotify(item: NotificationCenterItem, observer: SenseObserver | null): boolean {
  const tag = item.tag ?? '';
  if (SELF_APP_TAG.test(tag)) return true;
  if (observer && observerSessionKeys(observer).includes(tag)) return true;
  // item.pkg 已带来源包名时按包名判（未来扩展位；com.z.aiphone=本 App 自身）
  if (item.pkg === 'com.z.aiphone') return true;
  return false;
}

/** 通知条目人话描述（通知栏情报行用） */
function describeNotifyItem(item: NotificationCenterItem): string {
  const tag = item.tag ?? '';
  let app = '系统';
  if (/^wx/.test(tag)) app = '微信';
  else if (/^qq/.test(tag)) app = 'QQ';
  else if (/^(sms|chat)/.test(tag)) app = '信息';
  else if (/^(mtshop|mt-|meituan)/.test(tag)) app = '美团';
  else if (/^(tb-|taobao)/.test(tag)) app = '淘宝';
  else if (/^forum-/.test(tag)) app = 'X论坛';
  else if (/^ai-call/.test(tag)) app = '电话';
  else if (/^ai-vm/.test(tag)) app = '语音留言';
  else if (/^agent/.test(tag)) app = 'AI助手';
  const body = (item.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${app}·${(item.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)}：${body}${item.read ? '' : '（还没点开）'}`;
}

// ---------------- 网页模式追踪器（copy / 击键 / 键盘焦点 / 加速度滚动窗） ----------------

interface CopyRec {
  text: string;
  ts: number;
}

/** 模块级追踪状态（页会话内有效；监听器首个采集者到达时安装，幂等） */
const trackerState = {
  copies: [] as CopyRec[],
  keydowns: [] as number[],
  keyboardFocusAt: null as number | null,
  motionDevs: [] as { dev: number; ts: number }[],
  motionSeen: false,
};

let trackersInstalled = false;

/** 输入类元素判定（键盘弹起代理：焦点落在文本输入上=虚拟键盘弹起） */
function isTextInputEl(t: EventTarget | null): boolean {
  if (!t || typeof (t as HTMLElement).tagName !== 'string') return false;
  const el = t as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (tag === 'select' || tag === 'button' || tag === 'a') return false;
  const attr = el.getAttribute?.('contenteditable');
  return attr === '' || attr === 'true';
}

/** 安装网页追踪器（幂等；失败静默——不影响任何主链路） */
function ensureWebTrackers(): void {
  if (trackersInstalled || typeof window === 'undefined') return;
  trackersInstalled = true;
  try {
    // 剪贴板：copy 事件（选区文本优先；拿不到时退回 clipboardData 文本）
    document.addEventListener('copy', () => {
      try {
        let text = '';
        try {
          text = window.getSelection?.()?.toString() ?? '';
        } catch {
          text = '';
        }
        if (!text) return;
        trackerState.copies.unshift({ text: text.slice(0, 120), ts: Date.now() });
        if (trackerState.copies.length > 5) trackerState.copies.length = 5;
      } catch {
        /* 静默 */
      }
    }, true);
    // 击键频率（keydown 计数；纯修饰键不计——那是组合键操作不是打字）
    window.addEventListener(
      'keydown',
      (e) => {
        try {
          if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'CapsLock' || e.key === 'Tab' || e.key === 'Escape') return;
          trackerState.keydowns.push(Date.now());
          if (trackerState.keydowns.length > 600) trackerState.keydowns.splice(0, 300);
        } catch {
          /* 静默 */
        }
      },
      true,
    );
    // 键盘焦点（focusin/focusout 委托：输入元素聚焦=键盘弹起）
    document.addEventListener('focusin', (e) => {
      try {
        trackerState.keyboardFocusAt = isTextInputEl(e.target) ? Date.now() : null;
      } catch {
        /* 静默 */
      }
    }, true);
    document.addEventListener('focusout', () => {
      trackerState.keyboardFocusAt = null;
    }, true);
    // 移动感知：DeviceMotion 加速度滚动窗（iOS 需用户手势授权，无事件=无此维度，静默）
    window.addEventListener('devicemotion', (e: DeviceMotionEvent) => {
      try {
        const a = e.accelerationIncludingGravity;
        if (!a || (a.x === null && a.y === null && a.z === null)) return;
        const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
        const dev = Math.abs(mag - 9.81);
        trackerState.motionSeen = true;
        trackerState.motionDevs.push({ dev, ts: Date.now() });
        if (trackerState.motionDevs.length > 120) trackerState.motionDevs.splice(0, 60);
      } catch {
        /* 静默 */
      }
    });
  } catch {
    /* 安装失败：所有网页追踪维度自动缺席，采集照常 */
  }
}

// ---------------- 网页模式采集（绝不触碰真机桥） ----------------

/** 【通知栏】网页手机通知中心快照（自我过滤后） */
function webNotifyLines(observer: SenseObserver | null): string[] {
  try {
    const now = Date.now();
    const items = useNotifyCenter.getState().items; // 新→旧
    const candidates = items.filter((i) => !i.read || now - i.ts < 30 * 60_000).slice(0, 10);
    const rows = candidates.filter((i) => !isSelfNotify(i, observer)).slice(0, 6).map(describeNotifyItem);
    if (rows.length === 0) return [];
    return [`【TA 的通知栏（网页手机实时快照）】${rows.join('；')}`];
  } catch {
    return [];
  }
}

/** 【剪贴板】网页 copy 追踪 */
function webClipboardLines(): string[] {
  try {
    ensureWebTrackers();
    const now = Date.now();
    const recent = trackerState.copies.filter((c) => now - c.ts < 20 * 60_000).slice(0, 2);
    if (recent.length === 0) return [];
    const parts = recent.map((c) => `「${c.text.slice(0, 50)}」（${Math.max(1, Math.round((now - c.ts) / 60_000))} 分钟前）`);
    return [`【剪贴板】TA 最近复制过：${parts.join('；')}——可以问 TA 复制这些干嘛`];
  } catch {
    return [];
  }
}

/** 网页模式全维度采集入口（各维度独立降级：缺一个少一行，绝不炸整轮） */
export async function collectWebExtraLines(observer: SenseObserver | null): Promise<string[]> {
  const lines: string[] = [];
  // 通知栏（纯同步读 store）
  lines.push(...webNotifyLines(observer));
  // 剪贴板（同步读追踪器）
  lines.push(...webClipboardLines());
  // 屏幕与电源（store/电量）
  lines.push(...(await webPowerScreen()));
  // 移动感知（同步读滚动窗）
  lines.push(...webMotionLines());
  // 正在播放（音乐 store）
  lines.push(...(await webMediaLines()));
  // 通话与未接（来电层 + call-logs）
  lines.push(...(await webCallLines()));
  // 键盘与击键频率（需读当前 App 判定「在跟谁打字」）
  lines.push(...(await webKeyboardLines(observer)));
  return lines;
}

/** 【屏幕与电源】实际实现（store 动态加载） */
async function webPowerScreen(): Promise<string[]> {
  const parts: string[] = [];
  try {
    const { useUI } = await import('./store');
    const ui = useUI.getState();
    const pageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const hour = new Date().getHours();
    if (ui.locked) parts.push('手机锁着屏');
    else if (ui.screenOff) parts.push('手机熄屏中');
    else if (pageHidden) parts.push('网页切到了后台（亮灭屏未知）');
    else {
      parts.push('手机亮着屏');
      if (hour >= 1 && hour < 6) parts.push(`现在是凌晨 ${hour} 点——TA 还亮着屏在玩手机，该催 TA 睡觉了`);
    }
  } catch {
    /* store 读失败：跳过屏幕行 */
  }
  try {
    const b = getBatterySnapshot();
    if (b) parts.push(`设备电量 ${Math.round(b.level)}%${b.charging ? '（正在充电）' : '（没在充电）'}`);
  } catch {
    /* 电量失败跳过 */
  }
  if (parts.length === 0) return [];
  return [`【屏幕与电源】${parts.join('；')}`];
}

/** 【移动感知】DeviceMotion 滚动窗分类 */
function webMotionLines(): string[] {
  try {
    ensureWebTrackers();
    if (!trackerState.motionSeen) return []; // 无传感器（桌面/未授权）：该维度缺席
    const now = Date.now();
    const win = trackerState.motionDevs.filter((m) => now - m.ts < 40_000);
    if (win.length < 4) return []; // 样本不足：不下结论
    const avg = win.reduce((s, m) => s + m.dev, 0) / win.length;
    const max = Math.max(...win.map((m) => m.dev));
    if (avg > 3.2 || max > 8) return ['【移动感知】TA 的手机正在剧烈晃动/移动（走路、坐车或拿着手机做别的事）——问 TA 去哪了'];
    if (avg > 1.1) return ['【移动感知】TA 的手机在轻微移动（可能拿着手机走动）'];
    return []; // 静止是常态：不占情报行
  } catch {
    return [];
  }
}

/** 【正在播放】网页音乐 store */
async function webMediaLines(): Promise<string[]> {
  try {
    const { useMusic, nowPlayingSnapshot } = await import('./music-store');
    const st = useMusic.getState();
    const np = nowPlayingSnapshot();
    if (st.playing && np?.song) {
      const artist = (np.song.artists ?? []).map((a: { name?: string }) => a.name ?? '').filter(Boolean).join('/');
      const min = Math.floor((st.position ?? 0) / 60);
      return [
        `【正在播放】TA 的网页手机正在放歌：${artist ? `《${np.song.name}》-${artist}` : `《${np.song.name}》`}${
          min > 0 ? `（已经连着放了约 ${min} 分钟）` : ''
        }`,
      ];
    }
  } catch {
    /* 音乐状态读不到：跳过 */
  }
  return [];
}

/** 【通话】来电响铃 / 通话中 / 今日未接来电（call-logs IndexedDB） */
async function webCallLines(): Promise<string[]> {
  const parts: string[] = [];
  try {
    const inc = useIncomingCall.getState().call;
    if (inc) parts.push(`手机正有来电响铃（${inc.name}打来的）`);
  } catch {
    /* 静默 */
  }
  try {
    const { useUI } = await import('./store');
    if (useUI.getState().callActive) parts.push('TA 此刻正在通话中');
  } catch {
    /* 静默 */
  }
  try {
    const { localDB } = await import('./db');
    const logs = await localDB.getAll('call-logs');
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const missed = logs
      .filter((l) => l.direction === 'missed' && l.createdAt >= todayStart)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (missed.length > 0) {
      const names = missed.slice(0, 3).map((m) => m.displayName || '未知号码').join('、');
      parts.push(`今天有 ${missed.length} 条未接来电（${names}${missed.length > 3 ? ' 等' : ''}）`);
    }
  } catch {
    /* 通话记录读不到：跳过 */
  }
  if (parts.length === 0) return [];
  return [`【通话】${parts.join('；')}`];
}

/** 【键盘】键盘弹起 + 击键频率（「正在跟谁打字」按当前 App 推断：在观察者聊天 App 里=回你） */
async function webKeyboardLines(observer: SenseObserver | null): Promise<string[]> {
  try {
    ensureWebTrackers();
    const now = Date.now();
    const recent = trackerState.keydowns.filter((t) => now - t < 3 * 60_000);
    if (recent.length === 0) return [];
    const rate = Math.round(recent.length / 3); // 近 3 分钟 → 次/分钟
    let inObserverApp = false;
    if (observer) {
      try {
        const { useUI } = await import('./store');
        const targetApp = observer.app === 'wx' ? 'wechat' : observer.app === 'qq' ? 'qq' : 'chat';
        inObserverApp = useUI.getState().activeApp === targetApp;
      } catch {
        inObserverApp = false;
      }
    }
    const focus = trackerState.keyboardFocusAt !== null;
    const kb = focus ? '键盘正弹着' : '键盘刚收起';
    if (inObserverApp) {
      return [`【键盘】TA 正在打字（${kb}，最近 3 分钟约 ${recent.length} 次击键）——就在跟你聊天的 App 里，多半是在回你消息`];
    }
    if (recent.length >= 40) {
      return [`【键盘】TA 正在高强度打字（${kb}，最近 3 分钟约 ${recent.length} 次击键、≈${rate} 次/分钟）——不在你的聊天界面里，多半在跟别人聊得火热或在发帖`];
    }
    return [`【键盘】TA 正在打字（${kb}，最近 3 分钟约 ${recent.length} 次击键）`];
  } catch {
    return [];
  }
}

// ---------------- 真机模式采集（全部经 Shizuku 白名单；绝不读网页虚拟状态） ----------------

/** 常见真机包名 → 中文名（通知/媒体情报行展示用；未知名回退原包名） */
const DEVICE_PKG_NAMES: Record<string, string> = {
  'com.tencent.mm': '微信',
  'com.tencent.mobileqq': 'QQ',
  'com.tencent.tim': 'QQ-TIM',
  'com.ss.android.ugc.aweme': '抖音',
  'com.smile.gifmaker': '快手',
  'tv.danmaku.bili': 'B站',
  'com.xingin.xhs': '小红书',
  'com.sina.weibo': '微博',
  'com.dragon.read': '番茄小说',
  'com.tencent.tmgp.sgame': '王者荣耀',
  'com.netease.cloudmusic': '网易云音乐',
  'com.tencent.qqmusic': 'QQ音乐',
  'com.kugou.android': '酷狗音乐',
  'com.taobao.taobao': '淘宝',
  'com.jingdong.app.mall': '京东',
  'com.xunmeng.pinduoduo': '拼多多',
  'com.sankai.meituan': '美团',
  'com.sankai.meituan.takeoutnew': '美团外卖',
  'com.eastmoney.android.berlin': '东方财富',
  'com.android.mms': '短信',
  'com.android.dialer': '电话',
};

/** 真机自我过滤：本 App 自己（com.z.aiphone*）+ 系统界面（com.android.systemui） */
function isSelfDevicePkg(pkg: string): boolean {
  return pkg === 'com.z.aiphone' || pkg.startsWith('com.z.aiphone.') || pkg === 'com.android.systemui';
}

function devicePkgName(pkg: string): string {
  return DEVICE_PKG_NAMES[pkg] ?? pkg;
}

/** Shizuku exec 轻封装（缺省超时 8s；浏览器/断连 → null 静默降级） */
async function shRun(cmd: string[], opts: { mustContain?: string[]; maxLines?: number; timeoutMs?: number } = {}): Promise<string | null> {
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    const r = await nativeShizukuExec(cmd, { maxLines: opts.maxLines ?? 200, timeoutMs: opts.timeoutMs ?? 8000, ...(opts.mustContain ? { mustContain: opts.mustContain } : {}) });
    if (!r || !r.ok) return null;
    return r.out ?? '';
  } catch {
    return null;
  }
}

/** 【通知栏】dumpsys notification --noredact（自我过滤 com.z.aiphone/systemui） */
async function deviceNotifyLines(): Promise<string[]> {
  const out = await shRun(['dumpsys', 'notification', '--noredact'], { maxLines: 2600, timeoutMs: 12_000 });
  if (!out) return [];
  try {
    const rows: { pkg: string; title: string; text: string }[] = [];
    let curPkg = '';
    let title = '';
    let text = '';
    const flush = () => {
      if (curPkg && (title || text)) rows.push({ pkg: curPkg, title, text });
      title = '';
      text = '';
    };
    for (const raw of out.split('\n')) {
      const l = raw.trim();
      const pm = /^package=([\w.]+)/.exec(l);
      if (pm) {
        flush();
        curPkg = pm[1];
        continue;
      }
      const tm = /^android.title=(.+)$/.exec(l);
      if (tm) {
        title = tm[1].trim();
        continue;
      }
      const xm = /^android.text=(.*)$/.exec(l);
      if (xm) {
        // 文本可能是 CharSequence 串（带引号/跨行对象）：只留可见字符
        text = xm[1].replace(/[^\u4e00-\u9fa5\w，。！？…·、“”‘’（）()\-:：,.\s]/g, '').trim().slice(0, 30);
        continue;
      }
    }
    flush();
    // 自我过滤 + 去重（同包同标题只留一条）+ 截短
    const seen = new Set<string>();
    const filtered = rows.filter((r) => {
      if (isSelfDevicePkg(r.pkg)) return false;
      const key = `${r.pkg}|${r.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (filtered.length === 0) return [];
    const parts = filtered.slice(-6).map((r) => `${devicePkgName(r.pkg)}「${r.title.slice(0, 16)}」${r.text ? `：${r.text}` : ''}`);
    return [`【TA 真机的通知栏（实时快照）】${parts.join('；')}`];
  } catch {
    return [];
  }
}

/** 【剪贴板】dumpsys clipboard（各 ROM 版本差异大，宽松解析、解析不出即缺席） */
async function deviceClipboardLine(): Promise<string[]> {
  const out = await shRun(['dumpsys', 'clipboard'], { maxLines: 80, timeoutMs: 6000 });
  if (!out) return [];
  try {
    for (const raw of out.split('\n')) {
      const l = raw.trim();
      if (!/clip/i.test(l)) continue;
      // 取行内成对双引号的纯文本（ClipData { text/plain "内容" } / text="内容" 形态）
      const quotes = [...l.matchAll(/"([^"\n]{2,120})"/g)].map((m) => m[1]);
      for (const q of quotes) {
        if (/^(content|intent):\/\//i.test(q)) continue;
        if (/^android\./i.test(q)) continue;
        if (/^text\/plain$/i.test(q)) continue;
        return [`【剪贴板】TA 真机的剪贴板里存着：「${q.slice(0, 60)}」——可以问 TA 复制这个干嘛`];
      }
    }
  } catch {
    /* 静默 */
  }
  return [];
}

/** 【屏幕与电源】dumpsys battery + dumpsys power + settings 亮度 */
async function devicePowerLines(): Promise<string[]> {
  const parts: string[] = [];
  try {
    const bat = await shRun(['dumpsys', 'battery'], { maxLines: 40, timeoutMs: 6000 });
    if (bat) {
      const level = /level:\s*(\d+)/.exec(bat)?.[1];
      const charging = /status:\s*2/.test(bat);
      if (level) parts.push(`电量 ${level}%${charging ? '（正在充电）' : '（没在充电）'}`);
    }
  } catch {
    /* 静默 */
  }
  try {
    const pw = await shRun(['dumpsys', 'power'], { maxLines: 400, timeoutMs: 6000 });
    if (pw) {
      const awake = /mWakefulness=Awake/.test(pw);
      const dispOn = /Display Power: state=ON/i.test(pw) || /mHoldingDisplay=true/.test(pw);
      const dispOff = /Display Power: state=OFF/i.test(pw);
      if (dispOn || (awake && !dispOff)) parts.push('屏幕亮着');
      else if (dispOff || /mWakefulness=Asleep/.test(pw)) parts.push('屏幕熄着');
      const hour = new Date().getHours();
      if ((dispOn || (awake && !dispOff)) && hour >= 1 && hour < 6) {
        parts.push(`现在是凌晨 ${hour} 点——TA 还亮着屏在玩手机，该催 TA 睡觉了`);
      }
    }
  } catch {
    /* 静默 */
  }
  try {
    const br = await shRun(['settings', 'get', 'system', 'screen_brightness'], { maxLines: 4, timeoutMs: 4000 });
    if (br) {
      const v = Number(br.trim());
      if (Number.isFinite(v) && v > 0 && v <= 255) parts.push(`当前亮度约 ${Math.round((v / 255) * 100)}%`);
    }
  } catch {
    /* 静默 */
  }
  if (parts.length === 0) return [];
  return [`【屏幕与电源】${parts.join('；')}`];
}

/** 【移动感知】dumpsys sensorservice 加速度单拍（ROM 输出差异大，宽松解析） */
async function deviceMotionLine(): Promise<string[]> {
  const out = await shRun(['dumpsys', 'sensorservice'], { maxLines: 900, timeoutMs: 8000 });
  if (!out) return [];
  try {
    // 找 Accelerometer 传感器行后的 last event（x=.. y=.. z=..；部分 ROM 用十六进制/科学计数）
    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/accelerometer/i.test(lines[i])) continue;
      const scope = [lines[i], lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ');
      const m = /x=([+-]?[\d.]+)[\s,]+y=([+-]?[\d.]+)[\s,]+z=([+-]?[\d.]+)/i.exec(scope);
      if (!m) continue;
      const x = Number(m[1]);
      const y = Number(m[2]);
      const z = Number(m[3]);
      if (![x, y, z].every((v) => Number.isFinite(v))) continue;
      const mag = Math.sqrt(x * x + y * y + z * z);
      const dev = Math.abs(mag - 9.81);
      if (dev > 3.5) return ['【移动感知】TA 的真机正在剧烈移动（走路/坐车/摇晃中）——问 TA 去哪了'];
      if (dev > 1.2) return ['【移动感知】TA 的真机在轻微移动'];
      return []; // 静止：不占情报行
    }
  } catch {
    /* 静默 */
  }
  return [];
}

/** 【正在播放】dumpsys media_session（活跃会话 ownerPkg + title/artist） */
async function deviceMediaLines(): Promise<string[]> {
  const out = await shRun(['dumpsys', 'media_session'], { maxLines: 400, timeoutMs: 8000 });
  if (!out) return [];
  try {
    const blocks = out.split(/MediaSessionRecord/).slice(1);
    for (const b of blocks) {
      const pkg = /ownerPkg=([\w.]+)/.exec(b)?.[1] ?? '';
      if (!pkg || isSelfDevicePkg(pkg)) continue;
      const playing = /state=3\((Playing|playing)\)/.test(b) || /state=3\b/.test(b);
      if (!playing) continue;
      const title = /title="?([^"\n]{1,60})"?/.exec(b)?.[1]?.trim();
      const artist = /artist="?([^"\n]{1,60})"?/.exec(b)?.[1]?.trim();
      const seg = title ? `《${title}》${artist ? `-${artist}` : ''}` : '未知内容';
      return [`【正在播放】TA 的真机正在用${devicePkgName(pkg)}放：${seg}`];
    }
  } catch {
    /* 静默 */
  }
  return [];
}

/** 【通话】dumpsys telecom 活跃通话 + content call_log 今日未接 */
async function deviceCallLines(): Promise<string[]> {
  const parts: string[] = [];
  try {
    const tc = await shRun(['dumpsys', 'telecom'], { maxLines: 500, timeoutMs: 8000 });
    if (tc) {
      if (/state=ACTIVE\b/.test(tc)) parts.push('TA 此刻正在通话中');
      else if (/state=RINGING\b/.test(tc)) parts.push('TA 的手机正有来电响铃');
      else if (/state=DIALING\b/.test(tc) || /state=HOLDING\b/.test(tc)) parts.push('TA 此刻有进行中的电话');
    }
  } catch {
    /* 静默 */
  }
  try {
    const cl = await shRun(
      ['content', 'query', '--uri', 'content://call_log/calls', '--projection', 'name:date:type', '--where', 'type=3', '--sort', '"date DESC"'],
      { maxLines: 40, timeoutMs: 8000 },
    );
    if (cl) {
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const names: string[] = [];
      for (const raw of cl.split('\n')) {
        const dateM = /date=(\d+)/.exec(raw);
        if (!dateM) continue;
        const ts = Number(dateM[1]);
        if (!Number.isFinite(ts) || ts < todayStart) continue;
        const name = /name=([^,\s]+)/.exec(raw)?.[1] ?? '未知';
        if (!names.includes(name)) names.push(name);
        if (names.length >= 3) break;
      }
      const count = (cl.match(/type=3/g) ?? []).length;
      if (names.length > 0) parts.push(`今天有未接来电（${names.join('、')}${count > 3 ? ` 等 ${count} 条` : ''}）`);
    }
  } catch {
    /* 静默 */
  }
  if (parts.length === 0) return [];
  return [`【通话】${parts.join('；')}`];
}

/** 【键盘】dumpsys input_method 键盘弹起态 */
async function deviceKeyboardLine(): Promise<string[]> {
  const out = await shRun(['dumpsys', 'input_method'], { mustContain: ['mIsInputViewShown'], maxLines: 60, timeoutMs: 6000 });
  if (!out) return [];
  try {
    if (/mIsInputViewShown=true/.test(out)) return ['【键盘】TA 的真机键盘正弹着（大概率正在打字）'];
  } catch {
    /* 静默 */
  }
  return [];
}

/** 真机模式全维度采集入口（Promise.allSettled 并行：总耗时=最慢单项，单项失败各自缺席） */
export async function collectDeviceExtraLines(): Promise<string[]> {
  const jobs = await Promise.allSettled([
    deviceNotifyLines(),
    deviceClipboardLine(),
    devicePowerLines(),
    deviceMotionLine(),
    deviceMediaLines(),
    deviceCallLines(),
    deviceKeyboardLine(),
  ]);
  const lines: string[] = [];
  for (const j of jobs) {
    if (j.status === 'fulfilled') lines.push(...j.value);
  }
  return lines;
}

