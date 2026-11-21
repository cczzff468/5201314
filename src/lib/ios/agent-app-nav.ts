'use client';

/**
 * 语音助手「打开 App」直达导航（v1.7.2）：
 *
 * 语音会话里说「打开微信」→ 直接切到**网页内（本项目虚拟手机）的微信页面**，
 * 不走 Shizuku 真机自动化——不依赖 Shizuku 是否启动，也不会再出现「Shizuku 没在跑、
 * 任务 3 轮失败」的体验。导航复用 switchToApp 总线（与通知直达/跨 App 跳转同源）。
 *
 * - matchOpenAppIntent(text)：识别「打开/进入/切到/看看 + 应用名」或光说应用名，
 *   命中返回 AppId + 展示名；未命中（发消息/创建联系人等真任务）返回 null 走 Agent
 * - openAppPage(appId)：锁屏/熄屏/多任务态拒绝（返回 false），否则 switchToApp 切页
 */

import { useUI, type AppId } from './store';

// ============================================================
// A. 应用同义词表（长词在前防误切，如「通讯录」先于「电话」）
// ============================================================

interface AppEntry {
  id: AppId;
  /** 展示名（回复播报用） */
  label: string;
  /** 触发词（小写；包含匹配） */
  keys: string[];
}

/** 有序表：同义词长的放前面（避免「通讯录」被「电话」截胡之类） */
const APP_ENTRIES: AppEntry[] = [
  { id: 'wechat', label: '微信', keys: ['微信', 'weixin', 'wechat'] },
  { id: 'qq', label: 'QQ', keys: ['qq'] },
  { id: 'taobao', label: '淘宝', keys: ['淘宝'] },
  { id: 'meituan', label: '美团', keys: ['美团', '外卖'] },
  { id: 'contacts', label: '通讯录', keys: ['通讯录', '联系人'] },
  { id: 'chat', label: '信息', keys: ['信息', '短信', '短讯'] },
  { id: 'phone', label: '电话', keys: ['电话', '拨号'] },
  { id: 'notes', label: '备忘录', keys: ['备忘录', '笔记', '便签'] },
  { id: 'reminders', label: '提醒事项', keys: ['提醒事项'] },
  { id: 'calendar', label: '日历', keys: ['日历'] },
  { id: 'weather', label: '天气', keys: ['天气'] },
  { id: 'music', label: '音乐', keys: ['音乐'] },
  { id: 'photos', label: '照片', keys: ['照片', '相册', '图库'] },
  { id: 'camera', label: '相机', keys: ['相机'] },
  { id: 'clock', label: '时钟', keys: ['时钟', '闹钟', '秒表'] },
  { id: 'calculator', label: '计算器', keys: ['计算器'] },
  { id: 'files', label: '文件', keys: ['文件'] },
  { id: 'browser', label: '浏览器', keys: ['浏览器', 'safari'] },
  { id: 'settings', label: '设置', keys: ['设置', '系统设置'] },
  { id: 'themes', label: '主题', keys: ['主题', '壁纸'] },
  { id: 'appstore', label: '应用商店', keys: ['应用商店', 'appstore', 'app store'] },
  { id: 'memory', label: '记忆库', keys: ['记忆库', '记忆'] },
  { id: 'worldbook', label: '世界书', keys: ['世界书'] },
  { id: 'recorder', label: '录音', keys: ['录音'] },
  { id: 'couple', label: '情侣空间', keys: ['情侣空间', '情侣小家', '情侣'] },
  { id: 'cottage', label: '小屋', keys: ['小屋', '小窝', '木屋'] },
  { id: 'forum', label: '论坛', keys: ['论坛', '帖子广场'] },
];

// ============================================================
// B. 意图匹配
// ============================================================

/** 打开类动词（命中任一 + 应用名 + 应用名后无其它宾语 → 直达） */
const OPEN_VERB_RE = /打开|开启|启动|进入|切到|切换到|转到|跳到|看看|看一下|看下|逛逛|登录|登入|给我开|帮我开/;

/** 句尾可跟的语气词/补语（剥掉后剩余 ≈ 应用名也命中） */
const TAIL_FILLER_RE = /[吧呗呢哦呀啊哈嘛~～]+$/;

/** 应用名后允许的收尾词（「打开微信页面」「进 QQ 应用」） */
const AFTER_OK_RE = /^(页面|界面|软件|app|应用|程序)/;

/**
 * 识别「打开某应用」意图：
 * ① 含打开动词 + 应用名，且应用名后没有其它宾语（「打开微信」✓，「打开微信里的零钱」✗）；
 * ② 无动词但整句剥掉语气词/客套词后就是应用名（「微信」「来个微信」「微信吧」）。
 * 「发微信给妈妈」「创建联系人」这类真任务不会命中，照旧交给 Agent。
 */
export function matchOpenAppIntent(text: string): { appId: AppId; label: string } | null {
  const raw = text.trim().toLowerCase().replace(TAIL_FILLER_RE, '').trim();
  if (!raw || raw.length > 24) return null;
  for (const entry of APP_ENTRIES) {
    const hit = entry.keys.find((k) => raw.includes(k));
    if (!hit) continue;
    const idx = raw.indexOf(hit);
    const before = raw.slice(0, idx);
    const after = raw.slice(idx + hit.length);
    if (OPEN_VERB_RE.test(raw)) {
      // 动词命中：应用名前 ≤6 字（帮我/给我/可以…），后面只允许「页面/APP」类收尾词
      const afterClean = after.replace(AFTER_OK_RE, '').replace(TAIL_FILLER_RE, '').trim();
      if (before.length <= 6 && afterClean.length === 0) return { appId: entry.id, label: entry.label };
      return null; // 应用名后还有别的宾语：不是纯打开意图，交给 Agent
    }
    // 无动词：剥掉应用名与客套字后不剩东西才算（「来个微信」✓，「微信里的零钱」✗）
    const stripped = (before + after).replace(/[帮我给我来个去看下哦嘛呀啊吧呢哈呗]/g, '').trim();
    if (stripped.length === 0) return { appId: entry.id, label: entry.label };
    return null;
  }
  return null;
}

// ============================================================
// C. 网页内直达
// ============================================================

/**
 * 切到应用内页面（switchToApp 总线：任何界面/任意 App 内都能切）。
 * 锁屏/熄屏/多任务切换态拒绝（返回 false，调用方给个「打不开」的说法）。
 */
export function openAppPage(appId: AppId): boolean {
  try {
    const ui = useUI.getState();
    if (ui.locked || ui.screenOff || ui.switcherOpen) return false;
    ui.switchToApp(appId);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// D. 系统包名/应用名 → 网页内应用映射（v1.8 Shizuku 未启动兜底）
// ============================================================

/**
 * 聊天里 AI 输出 [手机操作:打开:包名] 时，若 Shizuku 未运行（或根本在浏览器里），
 * 与其回一句冷冰冰的失败，不如把「这台手机里也有的应用」直接在网页内打开。
 * 下表只收与网页内 App 对得上的常用包名（键全小写）；抖音/B站等没有网页内对应体的不收，
 * 照旧走失败反馈。
 */
const PKG_TO_APP: [string, AppId, string][] = [
  // [包名/别名（小写），网页内 AppId，展示名]
  ['com.tencent.mm', 'wechat', '微信'],
  ['微信', 'wechat', '微信'],
  ['weixin', 'wechat', '微信'],
  ['com.tencent.mobileqq', 'qq', 'QQ'],
  ['qq', 'qq', 'QQ'],
  ['com.taobao.taobao', 'taobao', '淘宝'],
  ['淘宝', 'taobao', '淘宝'],
  ['taobao', 'taobao', '淘宝'],
  ['com.sankuai.meituan', 'meituan', '美团'],
  ['com.sankuai.meituan.takeoutnew', 'meituan', '美团'],
  ['美团', 'meituan', '美团'],
  ['com.netease.cloudmusic', 'music', '音乐'],
  ['网易云音乐', 'music', '音乐'],
  ['com.android.settings', 'settings', '设置'],
  ['设置', 'settings', '设置'],
  ['com.android.contacts', 'contacts', '通讯录'],
  ['com.android.dialer', 'phone', '电话'],
  ['com.android.deskclock', 'clock', '时钟'],
  ['com.android.calendar', 'calendar', '日历'],
  ['com.android.camera', 'camera', '相机'],
  ['com.android.gallery3d', 'photos', '照片'],
  ['com.android.browser', 'browser', '浏览器'],
  ['com.android.notes', 'notes', '备忘录'],
  ['天气', 'weather', '天气'],
];

/**
 * 包名（或中文应用名）→ 网页内应用匹配。
 * 返回 null = 网页内没有对应体（如抖音/原神），调用方照旧走失败反馈。
 */
export function matchWebAppByPackage(pkg: string): { appId: AppId; label: string } | null {
  const key = pkg.trim().toLowerCase();
  if (!key || key.length > 40) return null;
  for (const [k, appId, label] of PKG_TO_APP) {
    if (k === key) return { appId, label };
  }
  return null;
}
