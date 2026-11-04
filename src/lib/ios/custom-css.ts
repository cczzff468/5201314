/**
 * 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）——核心库
 * ---------------------------------------------------------------------------
 * 三个作用域（各自独立存储、互不影响）：
 *   1. global   全局：整个手机的所有界面（所有面板/按钮/弹层，含线下模式）；
 *   2. chat:app:联系人ID  聊天：只作用于「当前联系人」的聊天界面（消息/气泡/输入栏），
 *      每个联系人一套、互不影响（第七十轮：由按 App 升级为按联系人隔离）；
 *   3. offline  线下：只作用于线下模式的所有界面（开始页/见面页/存档/现场设置/历史）。
 *
 * 注入方式：CSS 文本经 scopeCss() 把每条选择器自动加上作用域前缀，再渲染成 <style> 标
 * —— 用户写的选择器只落在对应界面里，不会泄漏到别处。挂载点：
 *   global → [data-phone-shell]（手机壳）；
 *   聊天  → [data-phone-shell] [data-chat-css="wx:联系人ID"]（该联系人的聊天根）；
 *   线下  → [data-phone-shell] [data-offline-css]（线下模式根）。
 *
 * ── 优先级（用户指定，极度重要）：联系人聊天 CSS ＞ 线下 CSS ＞ 全局 CSS ＞ 内置主题 ──
 * 双保险实现：① 特异性阶梯——聊天/线下的前缀比全局多一级属性选择器
 * （聊天/线下用户规则 (0,3,0) vs 全局用户规则 (0,2,0)，无论各自写什么选择器都稳定压制）；
 * ② 源顺序——全局 <style> 渲染在手机壳内容首位，聊天/线下的 <style> 在各自组件内更靠后，
 * 同特异性时后者赢。内置主题（古早/液态玻璃）只是普通类名样式，永远在最底层。
 * 第六十九轮：& 可写在选择器任意位置（.dark & = 深色模式写法，html.dark 是手机壳祖先）。
 * 第七十一轮：示例从「主题」升级为「完整模板」——逐段列出界面上所有能改的元素
 * （背景/顶栏/底栏/气泡/尾巴/时间/输入栏/状态栏/面板/按钮/滚动条…），微信/QQ 各一份，
 * 按各自 App 的真实样式书写；每段默认值 = 当前样式，不改直接应用 ≈ 界面没变化。
 * 第七十五轮（用户指定：全局模板不要「一键换肤」）：全局模板全量清单化，逐项列出。
 * 第七十六轮（用户指定：模板按 App 分开、面板各自不同、更详细）：
 * 全局编辑器模板拆为四份——微信模板（聊天页/消息列表/通讯录/发现/我/朋友圈/
 * 聊天设置/状态卡片/红包转账亲属卡礼物代付外卖卡片逐张列出）、QQ模板（聊天/消息/
 * 联系人/动态/设置/卡片）、信息模板（会话列表/聊天页）、手机公共模板（手机壳/页面底/
 * 面板/表单/滚动条）；配套补齐语义锚点：wx-tabbar/wx-nav/wx-panel/wx-session-row/
 * wx-menu-row/wx-letter-bar/wx-moments-post·name·nav·act、qq-root/tabbar/head/search/
 * session-row/contact-row、sms-topbar/chat-list/bub-mine 与 bub-theirs 与 tail 系列/inputbar/
 * session-row/session-list/tabbar、chat-set-page/card/row（三 App 聊天设置共用组件）。
 * 细化版（本轮）：每套模板按界面分节（聊天界面 / 聊天卡片 / 红包·转账·亲属卡详情页 /
 * 微信(消息) / 联系人 / 发现 / 我 / 朋友圈 / 聊天设置），每段 = 一个元素——输入框 / 发送键 /
 * 语音·表情·加号按钮 / 加号·表情面板 / 多选栏 / 长按菜单 / 未读角标 / 分组条全部单独列出；
 * 编辑器模板按宿主 App 过滤（globalCssTemplates(app)：微信只列微信+手机公共、QQ 只列
 * QQ+手机公共、信息只列信息+手机公共）；配套新锚点：聊天设置页根挂 data-chat-set-app、
 * 微信好友详情页挂 wx-fdetail-page、线下挂 off-hero/off-feed/off-dock/off-panel-archive·
 * settings·history。
 * 第七十七轮（用户指定）：① 编辑器只显示一份「模板」（微信/QQ/信息/线下各自一份，
 * 「手机公共模板」删除——手机壳/页面底/面板/滚动条等公共部分并入各 App 模板的
 * 「手机壳与公共」一节）；② 模板补齐所有图标段（顶栏/输入栏/标签栏/多选栏/卡片
 * 的 SVG 图标——颜色跟按钮 color 走）；③ 联系人聊天模板与线下模板同样全量一份
 * （聊天页+全部卡片；线下全部界面+按钮图标）；④ CSS 字数不再设上限。
 *
 * 方案收藏：CustomCssScheme（自定义名字 + CSS 本体 + 归属作用域），三处编辑器共用一份清单，
 * 各编辑器只列出自己作用域保存的方案（聊天方案跟着联系人走）。
 *
 * 持久化：zustand useSettings → IndexedDB settings.customCss（与 bubbleStyle / chatDecor 分键互不影响）。
 */

/** 全部作用域 key（存储/读取用）：global / offline / chat:app:联系人ID（如 chat:wx:9） */
export type CustomCssScope = 'global' | 'offline' | `chat:${string}`;

/** 单个已命名方案（用户「保存」下来的 CSS 快照） */
export interface CustomCssScheme {
  id: string;
  name: string;
  css: string;
  /** 保存时所在的作用域（列表按作用域过滤展示） */
  scope: CustomCssScope;
  createdAt: number;
}

/** 自定义 CSS 全量配置（active = 当前应用的 CSS；空串 = 未应用） */
export interface CustomCssConfig {
  global: string;
  offline: string;
  /** 联系人聊天 CSS（key = `${app}:${联系人ID}` 如 "wx:9"，值 = 已应用的 CSS）——每个联系人一套 */
  chats: Record<string, string>;
  /** 已命名方案收藏（跨作用域共用一份清单） */
  schemes: CustomCssScheme[];
}

/* 第七十七轮（用户指定）：CSS 字数不再设上限——原 CUSTOM_CSS_MAX_LEN 已删除 */
/** 方案数量上限 */
export const CUSTOM_CSS_SCHEME_CAP = 30;
/** 方案名字数上限 */
export const CUSTOM_CSS_NAME_MAX = 24;
/** 联系人聊天 CSS 同时保留的套数上限（防脏档无限膨胀） */
export const CUSTOM_CSS_CHAT_CAP = 60;

export function defaultCustomCss(): CustomCssConfig {
  return { global: '', offline: '', chats: {}, schemes: [] };
}

// ---------------- 联系人聊天作用域（第七十轮：按联系人隔离） ----------------

/**
 * 联系人存储 key：`${app}:${encodeURIComponent(contactId)}`（如 "wx:9" / "qq:c3"）。
 * encodeURIComponent 保证 key 只含安全字符——它同时会被拼进 CSS 属性选择器
 * `[data-chat-css="..."]`，绝不能出现引号/反斜杠。
 */
export function chatContactKey(app: 'wx' | 'qq', contactId: string): string {
  return `${app}:${encodeURIComponent(String(contactId))}`;
}

/** 联系人编辑器的作用域 key：`chat:wx:9`（chats 存储 key 再去掉前缀） */
export function chatCssScope(app: 'wx' | 'qq', contactId: string): CustomCssScope {
  return `chat:${chatContactKey(app, contactId)}`;
}

/** 统一读取「某作用域当前已应用的 CSS」（编辑器/聊天页挂载共用，空串 = 未应用） */
export function readCustomCssActive(cfg: CustomCssConfig, scope: CustomCssScope): string {
  if (scope === 'global') return cfg.global;
  if (scope === 'offline') return cfg.offline;
  return cfg.chats[scope.slice('chat:'.length)] ?? '';
}

// ---------------- 作用域选择器（挂载 <style> 用，特异性阶梯见文件头） ----------------

/** 全局（基础优先级）：手机壳内所有元素 */
export const GLOBAL_CSS_SCOPE = '[data-phone-shell]';
/** 线下（次高优先级）：多一级属性 → 特异性压制全局 */
export const OFFLINE_CSS_SCOPE = '[data-phone-shell] [data-offline-css]';
/** 联系人聊天（最高优先级）：多一级属性 → 特异性压制全局；与线下界面互斥不相遇 */
export function chatCssScopeSelector(contactKey: string): string {
  return `[data-phone-shell] [data-chat-css="${contactKey}"]`;
}

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法 CSS 文本；非字符串回空串（第七十七轮：不截断） */
function normalizeCssText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认。
 *  第七十轮迁移：旧档的 'chat-wx'/'chat-qq' 字段（按 App 的聊天 CSS）无法拆分到具体联系人，
 *  直接弃用（方案库里的旧聊天方案归入 global 列表，CSS 文本不丢，可复制到联系人编辑器再用）。 */
export function normalizeCustomCss(v: unknown): CustomCssConfig {
  const base = defaultCustomCss();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  // 联系人聊天 CSS：key 校验安全字符（会拼进属性选择器），空串剔除，最多保留 CHAT_CAP 套
  const chats: Record<string, string> = {};
  if (o.chats && typeof o.chats === 'object') {
    let count = 0;
    for (const [k, val] of Object.entries(o.chats as Record<string, unknown>)) {
      if (count >= CUSTOM_CSS_CHAT_CAP) break;
      // key 形如 "wx:9"：app 前缀 + encodeURIComponent 输出（字母数字 - _ . ! ~ * ' ( ) % 和分隔冒号，无引号/反斜杠）
      if (!/^[a-z][a-zA-Z0-9\-_.!~*'():%]*$/.test(k)) continue;
      const css = normalizeCssText(val);
      if (!css.trim()) continue;
      chats[k] = css;
      count++;
    }
  }
  const schemes = Array.isArray(o.schemes)
    ? o.schemes
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: typeof s.name === 'string' ? s.name.slice(0, CUSTOM_CSS_NAME_MAX) : '未命名',
          css: normalizeCssText(s.css),
          // 合法：global / offline / chat:…；旧 'chat-wx'/'chat-qq' 方案归入 global 列表（文本不丢）
          scope: (typeof s.scope === 'string' && (s.scope === 'global' || s.scope === 'offline' || s.scope.startsWith('chat:'))
            ? s.scope
            : 'global') as CustomCssScope,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }))
        .slice(0, CUSTOM_CSS_SCHEME_CAP)
    : [];
  return {
    global: normalizeCssText(o.global),
    offline: normalizeCssText(o.offline),
    chats,
    schemes,
  };
}

// ---------------- 作用域前缀器 ----------------

/** 跳过一段字符串字面量（返回含结束引号的整段；处理 \ 转义） */
function skipString(src: string, start: number): string {
  const quote = src[start];
  let j = start + 1;
  while (j < src.length) {
    if (src[j] === '\\') j += 2;
    else if (src[j] === quote) return src.slice(start, j + 1);
    else if (src[j] === '\n') return src.slice(start, j); // 未闭合（容忍）
    else j++;
  }
  return src.slice(start);
}

/** 跳过一段注释（返回整段；未闭合容忍到结尾） */
function skipComment(src: string, start: number): string {
  const end = src.indexOf('*/', start + 2);
  return end === -1 ? src.slice(start) : src.slice(start, end + 2);
}

/** 找到与 src[start]（'{'）配对的 '}'（字符串/注释/嵌套大括号感知）；返回其下标（找不到 = -1） */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  let k = start;
  while (k < src.length) {
    const c = src[k];
    if (c === '/' && src[k + 1] === '*') {
      k += skipComment(src, k).length;
      continue;
    }
    if (c === '"' || c === "'") {
      k += skipString(src, k).length;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return k;
    }
    k++;
  }
  return -1;
}

/** 单条选择器加前缀（html/body/:root → 作用域本身；& 嵌套任意位置 → 替换；组合器开头 → 直接拼接）
 *  第六十九轮：& 支持出现在选择器任意位置（`.dark &` = 深色模式下的作用域祖先写法，
 *  html.dark 是手机壳的祖先 → 稳定命中；模板靠它做「浅色一套 / 深色一套」双色规则） */
function prefixOneSelector(sel: string, scope: string): string {
  const s = sel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (s.includes('&')) return s.replace(/&/g, scope);
  if (/^(html|body|:root)$/i.test(s)) return scope;
  if (/^[>+~]/.test(s)) return `${scope} ${s}`;
  return `${scope} ${s}`;
}

/** 逗号分隔的选择器组逐个加前缀（括号/属性选择器/字符串里的逗号不切分） */
function prefixSelectorGroup(group: string, scope: string): string {
  const parts: string[] = [];
  let cur = '';
  let k = 0;
  while (k < group.length) {
    const c = group[k];
    if (c === '/' && group[k + 1] === '*') {
      const seg = skipComment(group, k);
      cur += seg;
      k += seg.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const seg = skipString(group, k);
      cur += seg;
      k += seg.length;
      continue;
    }
    if (c === '(' || c === '[') {
      // 括号/属性选择器内的逗号不切分：粗略深度计数（引号已在上面整段跳过）
      let depth = 1;
      let j = k + 1;
      while (j < group.length && depth > 0) {
        const cj = group[j];
        if (cj === '(' || cj === '[') depth++;
        else if (cj === ')' || cj === ']') depth--;
        j++;
      }
      cur += group.slice(k, j);
      k = j;
      continue;
    }
    if (c === ',' ) {
      parts.push(cur);
      cur = '';
      k++;
      continue;
    }
    cur += c;
    k++;
  }
  parts.push(cur);
  return parts
    .map((p) => prefixOneSelector(p, scope))
    .filter(Boolean)
    .join(', ');
}

/**
 * 把用户 CSS 的所有样式规则选择器加上作用域前缀（如 '[data-phone-shell]'）。
 * - @media / @supports / @layer / @container 块递归处理（内部规则照样加前缀）；
 * - @keyframes / @font-face / @property / @import 等原样保留（帧选择器/描述符不需要前缀）；
 * - 顶层 @ 语句（@import …; 第七十一轮补）：以分号结尾、没有块，直接透传，
 *   不再混进下一条规则的选择器里（模板里的字体示例被解开注释时，后面的规则不被破坏）；
 * - 字符串与注释原样透传（引号里的 { } , 不会干扰解析）。
 * 解析失败的片段原样保留 —— 宁可多生效也不吞用户的 CSS。
 */
export function scopeCss(css: string, scope: string): string {
  if (!css.trim()) return '';
  const input = css;   // 第七十七轮：字数不设上限
  let out = '';
  let prelude = '';
  let k = 0;
  while (k < input.length) {
    const c = input[k];
    if (c === '/' && input[k + 1] === '*') {
      const seg = skipComment(input, k);
      prelude += seg;
      k += seg.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const seg = skipString(input, k);
      prelude += seg;
      k += seg.length;
      continue;
    }
    // 顶层分号：@import / @charset / @namespace 这类无块 at 语句到此结束 → 原样透传并清空
    if (c === ';') {
      const pre = prelude.trim();
      if (pre.startsWith('@')) {
        out += `${pre};`;
        prelude = '';
      } else {
        prelude += c;
      }
      k++;
      continue;
    }
    if (c === '{') {
      const close = matchBrace(input, k);
      const inner = close === -1 ? input.slice(k + 1) : input.slice(k + 1, close);
      const pre = prelude.trim();
      prelude = '';
      const at = /^@([\w-]+)/.exec(pre);
      if (at) {
        const name = at[1].toLowerCase();
        if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container' || name === 'scope') {
          // 条件块：内部再解析（里面的样式规则继续加前缀；嵌套 @keyframes 原样保留）
          out += `${pre} {${scopeCss(inner, scope)}}`;
        } else {
          // @keyframes / @font-face / @property / @counter-style 等：原样保留
          out += `${pre} {${inner}}`;
        }
      } else if (pre) {
        // 普通样式规则：选择器加前缀，声明块原样保留
        out += `${prefixSelectorGroup(pre, scope)} {${inner}}`;
      } else {
        // 没有选择器的裸块（异常输入）：原样保留
        out += `{${inner}}`;
      }
      if (close === -1) break;
      k = close + 1;
      continue;
    }
    prelude += c;
    k++;
  }
  out += prelude;
  return out;
}

// ---------------- CSS 完整模板（第七十一轮：示例从「主题」升级为「完整模板」） ----------------
// 模板 = 界面元素清单：把该作用域里所有能改的东西逐段列出（背景 / 顶栏 / 底栏 / 气泡 /
// 尾巴 / 时间胶囊 / 输入栏 / 状态栏 / 灵动岛 / 面板 / 按钮 / 滚动条 / 文字选中…），
// 每段 = 真实选择器 + 该界面当前的默认值——不改直接应用 ≈ 界面没变化；
// 用户改哪段哪段生效，不想要的整段删掉。微信 / QQ 各一份，按各自 App 的真实样式书写。
// 默认由动态逻辑决定黑白的元素（状态栏/Home 条/输入光标）以注释形式列出，解开即填。

/** 一份可一键填入编辑框的完整模板（按钮文案 + 一句话说明 + CSS 本体） */
export interface CssTemplate {
  name: string;
  desc: string;
  css: string;
}

// ================= 全局（个性装扮 › 自定义CSS Tab · 第七十七轮：一份「模板」含全部） =================
// 用户指定（第七十七轮）：① 手机公共模板删除——公共部分（手机壳/页面底/面板/滚动条…）
// 合并进每份 App 模板的「手机壳与公共」一节，编辑器只显示一份「模板」；
// ② 模板名从「微信模板（全部界面）」改为「模板」；③ 模板补上所有图标段
// （顶栏/输入栏/标签栏/多选栏/卡片里的 SVG 图标——颜色跟按钮 color 走）；
// ④ CSS 字数不再设上限（CUSTOM_CSS_MAX_LEN 已删除）。
// 聊天作用域（联系人 › 聊天设置）与线下作用域（现场设置）同样是「一份模板含全部」。

/** 微信 · 模板：微信所有界面逐项列出——聊天界面（气泡/输入栏/按钮/图标/面板/菜单）、
 *  聊天卡片（红包/转账/亲属卡/礼物/代付/外卖…一张一段）、红包转账亲属卡详情页、
 *  微信主页 / 联系人 / 发现 / 我 / 朋友圈 / 聊天设置 / 手机壳与公共。 */
export const WX_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '微信全部界面：聊天 / 卡片 / 红包页 / 朋友圈 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   微信 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 聊天界面（气泡/输入栏/按钮/图标/面板/菜单）
   二 聊天卡片（红包/转账/亲属卡/礼物/代付…一张一段）
   三 红包/转账/亲属卡页面
   四 微信(消息)界面  五 联系人  六 发现  七 我
   八 朋友圈  九 聊天设置  十 手机壳与公共。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值。
   图标（返回箭头/笑脸/＋/发送…）是 SVG 线条，颜色跟着
   所在按钮的文字色（color）走——改按钮 color 图标就变。
   提醒：只想改某一个联系人，用该联系人 › 聊天设置 ›
   自定义CSS（优先级更高，只作用于 TA）。 */

/* ══ 一、聊天界面（所有微信联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 2. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.wx-topbar button { color: #000000; }
.dark & .wx-topbar button { color: #FFFFFF; }

/* ── 3. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine { background: #95EC69 !important; color: #000000; }
.dark & .wx-bub-mine { background: #3EB575 !important; color: #000000; }

/* ── 4. 对方的气泡（左侧白泡） ── */
.wx-bub-theirs { background: #FFFFFF !important; color: #000000; }
.dark & .wx-bub-theirs { background: #1E1E1E !important; color: #FFFFFF; }

/* ── 5. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 6. 时间胶囊（居中的时间小条） ── */
.wx-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .wx-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 9. 引用条（回复时输入框上方那条白条） ── */
[data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 10. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 11. 好友详情页（点对方名字进入的资料页底色） ── */
.wx-fdetail-page { background: #EDEDED; }
.dark & .wx-fdetail-page { background: #111111; }

/* ── 12. 底部输入栏（打字那一栏） ── */
.wx-inputbar { background: #EDEDED; border-color: rgba(0, 0, 0, 0.07); }
.dark & .wx-inputbar { background: #111111; border-color: rgba(255, 255, 255, 0.06); }

/* ── 13. 输入框（打字的白色方框；光标是微信绿） ── */
[data-testid='wx-chat-input'] { background: #FFFFFF; }
.dark & [data-testid='wx-chat-input'] { background: #232323; }

/* ── 14. 语音按钮（输入栏最左的圆圈钮＋声波图标） ── */
[data-testid='wx-voice-toggle'] > span {
  border-color: rgba(0, 0, 0, 0.85);
  color: rgba(0, 0, 0, 0.9);
}
.dark & [data-testid='wx-voice-toggle'] > span {
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(255, 255, 255, 0.9);
}

/* ── 15. 表情按钮（输入栏的笑脸图标） ── */
[data-testid='wx-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 16. 加号按钮（更多功能那个＋图标） ── */
[data-testid='wx-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 17. 麦克风按钮（输入框里的文字转语音开关；开启时变微信绿） ── */
[data-testid='wx-tts-toggle'] { color: rgba(0, 0, 0, 0.4); }
.dark & [data-testid='wx-tts-toggle'] { color: rgba(255, 255, 255, 0.4); }

/* ── 18. 发送按钮（右侧绿色按钮） ── */
[data-testid='wx-chat-send'] { background: #07C160; color: #FFFFFF; }
[data-testid='wx-chat-send']:active { background: #06AD56; }

/* ── 19. 加号面板（相册/转账/位置/线下…展开层） ── */
[data-testid='wx-plus-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-plus-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 20. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='wx-sticker-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-sticker-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 21. 多选栏按钮（长按消息进入多选：转发 / 收藏；图标跟色） ── */
[data-testid='wx-select-forward'],
[data-testid='wx-select-fav'] { color: rgba(0, 0, 0, 0.75); }
.dark & [data-testid='wx-select-forward'],
.dark & [data-testid='wx-select-fav'] { color: rgba(255, 255, 255, 0.75); }

/* ── 22. 多选栏删除键（红字红图标） ── */
[data-testid='wx-select-del'] { color: #FA5151; }

/* ══ 二、聊天卡片（一段一张，全在聊天页里） ══ */

/* ── 23. 所有卡片的圆角（微信小方角） ── */
.chat-card-body { border-radius: 4px; }

/* ── 24. 红包卡（红橙渐变 + 小尾巴） ── */
.chat-card-rp .chat-card-body {
  background: linear-gradient(135deg, #F2694C, #E94E38) !important;
}
.chat-card-rp .chat-card-tail { background: #EC5A42 !important; }

/* ── 25. 转账卡（橙色渐变 + 小尾巴） ── */
.chat-card-tr .chat-card-body {
  background: linear-gradient(135deg, #F6AC3D, #EF9A2E) !important;
}
.chat-card-tr .chat-card-tail { background: #F2A233 !important; }

/* ── 26. 亲属卡（米白卡身 + 小尾巴） ── */
.chat-card-fam .chat-card-body { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-body { background: #1E1E1E; }
.chat-card-fam .chat-card-tail { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-tail { background: #1E1E1E; }

/* ── 27. 礼物卡（深蓝星空 + 小尾巴） ── */
.chat-card-gift .chat-card-body {
  background: linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%) !important;
}
.chat-card-gift .chat-card-tail { background: #2C4E92 !important; }

/* ── 28. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 29. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 30. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 31. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 32. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 33. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 34. 卡片横幅（代付卡顶部的彩色横条；默认方角贴卡） ── */
.chat-card-banner { border-radius: 0; }

/* ── 35. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 36. 卡片底部标签条（红包/转账/亲属卡/礼物那行小字） ── */
.chat-card-label { color: rgba(255, 255, 255, 0.9); font-size: 12px; }

/* ── 37. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 38. 卡片里的图标（红包铜钱/礼物盒/外卖袋…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card-body svg { color: #FFE9B8; } */

/* ══ 三、红包 / 转账 / 亲属卡页面（点卡片进入） ══ */

/* ── 39. 发红包页（塞红包 · 金额 · 祝福语那页） ── */
[data-testid='wx-rp-compose'] { background: #EDEDED; }
.dark & [data-testid='wx-rp-compose'] { background: #111111; }

/* ── 40. 红包详情页（白色页身 + 红色头部横幅） ── */
[data-testid='wx-rp-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-rp-detail'] { background: #111111; }
[data-testid='wx-rp-detail'] > div { background: #F25844; }

/* ── 41. 开红包弹层（点「開」之前那页的黑色遮罩） ── */
[data-testid='wx-rp-open'] { background: rgba(0, 0, 0, 0.7); }

/* ── 42. 转账页（输入金额那页） ── */
[data-testid='wx-tr-compose'] { background: #EDEDED; }
.dark & [data-testid='wx-tr-compose'] { background: #111111; }

/* ── 43. 转账详情页 ── */
[data-testid='wx-tr-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-tr-detail'] { background: #111111; }

/* ── 44. 确认收款页（别人转账给你时那页） ── */
[data-testid='wx-tr-receive'] { background: #FFFFFF; }
.dark & [data-testid='wx-tr-receive'] { background: #111111; }

/* ── 45. 亲属卡领取页（送你一张亲属卡那页） ── */
[data-testid='wx-fc-claim'] { background: #EDEDED; }
.dark & [data-testid='wx-fc-claim'] { background: #111111; }

/* ── 46. 亲属卡详情页 ── */
[data-testid='wx-fc-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-fc-detail'] { background: #111111; }

/* ══ 四、微信界面（消息 Tab 主页） ══ */

/* ── 47. 顶部导航（头像/返回 + 标题 + 搜索图标 + ＋） ──
   默认透明贴着页面底色；想加底色解开下一行 */
/* .wx-nav { background: #EDEDED; } */

/* ── 48. 顶部导航图标（返回 / 搜索放大镜 / ＋；颜色跟文字色） ── */
.wx-nav button { color: rgba(0, 0, 0, 0.75); }
.dark & .wx-nav button { color: rgba(255, 255, 255, 0.75); }

/* ── 49. 会话列表白色面板（微信特有的一整幅白底） ── */
.wx-panel { background: #FFFFFF; }
.dark & .wx-panel { background: #1A1A1A; }

/* ── 50. 会话行（头像 + 名字 + 预览；默认透明，置顶行浅灰） ── */
.wx-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .wx-session-row { background: #ECECEC !important; } */
/* .dark & .wx-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 51. 未读角标（头像右上角红色数字） ── */
[data-testid^='wx-unread-badge-'],
[data-testid='wx-tab-badge-chats'],
[data-testid='wx-tab-badge-discover'] { background: #FA5151; }

/* ── 52. 右上角＋下拉菜单（深色小面板：添加朋友/扫一扫/收付款…） ── */
[data-testid='wx-plus-menu'] { background: #4C4C4C; color: #FFFFFF; }
.dark & [data-testid='wx-plus-menu'] { background: #383838; }

/* ── 53. 长按会话菜单（标为未读/置顶/删除那个白条菜单） ── */
[data-testid='wx-session-ctx'] {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.08);
}
.dark & [data-testid='wx-session-ctx'] {
  background: rgba(76, 76, 76, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 54. 底部标签栏（微信 / 通讯录 / 发现 / 我） ── */
.wx-tabbar {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.10);
}
.dark & .wx-tabbar {
  background: #1A1A1A;
  border-color: rgba(255, 255, 255, 0.10);
}

/* ── 55. 标签按钮与图标（未选中字色图标色一起换；
   选中色是程序控制的微信绿 #07C160） ── */
[data-testid^='wx-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='wx-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 五、联系人界面 ══ */

/* ── 56. 功能入口行（新的朋友 / 群聊 / 标签 / 公众号…；默认透明） ──
   这个锚点同时管「发现」页和「我」页的行——三页的行样式一起换 */
.wx-menu-row { background: transparent; }

/* ── 57. 字母分组条（A B C…吸顶那一行） ── */
.wx-letter-bar { background: #EDEDED; color: rgba(0, 0, 0, 0.5); }
.dark & .wx-letter-bar { background: #111111; color: rgba(255, 255, 255, 0.5); }

/* ── 58. 好友行（默认透明） ── */
[data-testid^='wx-contact-'] { background: transparent; }

/* ══ 六、发现界面 ══ */

/* ── 59. 入口行（朋友圈 / 视频号 / 扫一扫 / 看一看…） ──
   与联系人/我共用 .wx-menu-row 锚点（见 56）；想只换白面板里的行，
   解开下面这行 */
/* .wx-panel .wx-menu-row { background: #FFFFFF; } */

/* ══ 七、我界面 ══ */

/* ── 60. 名片区（头像 + 名字 + 微信号那一块；默认透明） ── */
[data-testid='wx-me-profile'] { background: transparent; }

/* ── 61. 功能行（服务 / 收藏 / 朋友圈 / 卡包 / 表情 / 设置） ──
   与联系人/发现共用 .wx-menu-row 锚点（见 56） */

/* ══ 八、朋友圈界面 ══ */

/* ── 62. 朋友圈页面底色 ── */
[data-testid='wx-moments-list'] { background: #FFFFFF; }
.dark & [data-testid='wx-moments-list'] { background: #111111; }

/* ── 63. 顶部导航（悬浮在封面上；滚过封面自动变白底，默认透明） ── */
/* .wx-moments-nav { background: rgba(255, 255, 255, 0.95); } */

/* ── 64. 「N条新消息」胶囊（封面下方那条深色气泡） ── */
[data-testid='wx-moments-pill'] { background: rgba(0, 0, 0, 0.7); }
.dark & [data-testid='wx-moments-pill'] { background: rgba(255, 255, 255, 0.2); }

/* ── 65. 动态卡（头像 + 名字 + 正文 + 配图一整行） ── */
.wx-moments-post {
  background: transparent;
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .wx-moments-post { border-color: rgba(255, 255, 255, 0.08); }

/* ── 66. 作者名字（微信经典蓝） ── */
.wx-moments-name { color: #576B95; }
.dark & .wx-moments-name { color: #8FA5C9; }

/* ── 67. 赞 / 评论小胶囊（时间右边那颗灰按钮） ── */
.wx-moments-act { background: #F2F2F2; }
.dark & .wx-moments-act { background: #2A2A2A; }

/* ── 68. 通知铃铛 / 相机图标（右上角两个；在封面上是白色带投影，
   滚下封面后变黑——程序按滚动状态切换，想固定颜色解开注释） ── */
/* [data-testid='wx-moments-notices'],
[data-testid='wx-moments-compose'] { color: #FFFFFF; } */

/* ══ 九、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 69. 设置页底色（备注/主题/翻译那页；QQ/信息不受影响） ── */
.chat-set-page[data-chat-set-app='wx'][class*='bg-[#EDEDED]'] { background: #EDEDED; }
.dark & .chat-set-page[data-chat-set-app='wx'][class*='bg-[#EDEDED]'] { background: #111111; }

/* ── 70. 设置卡（圆角 10px 方角卡 = 微信的） ── */
.chat-set-page[data-chat-set-app='wx'] .chat-set-card[class*='rounded-[10px]'] { background: #FFFFFF; }
.dark & .chat-set-page[data-chat-set-app='wx'] .chat-set-card[class*='rounded-[10px]'] { background: #1A1A1A; }

/* ── 71. 设置行（备注 / 主题 / 翻译 / 消息翻译…；默认透明） ── */
.chat-set-page[data-chat-set-app='wx'] .chat-set-row { background: transparent; }

/* ══ 十、手机壳与公共（所有 App 共用部分） ══ */

/* ── 72. 状态栏（顶部时间 · 信号 · 电池） ──
   默认自动选黑/白字；想固定颜色就解开注释填 */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 73. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 74. Home 指示条（屏幕最底部的小横杠） ──
   同样默认自动黑/白；想固定颜色就解开注释填 */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 75. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;   /* ← 所有 App 底色统一换成这个值 */
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;   /* 深色模式下这些页面的底色 */
}

/* ── 76. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}
/* ↑ 这行 = 系统默认（半透明，自动跟随深浅模式）；
   换成你要的颜色即可，如 rgba(255, 250, 240, 0.85) */

/* ── 77. 面板与卡片（设置页 · 弹窗 · 主题面板；线下模式的卡在现场设置里改） ── */
.rt-panel { background: #FFFFFF; }                    /* 古早主题白卡 */
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }  /* 液态玻璃内容卡 */
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }  /* 液态玻璃弹层 */
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }  /* 液态玻璃白色分组卡 */
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 78. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* 输入框打字时的光标颜色 */
/* input, textarea { caret-color: #FF7A59; } */
/* 选择框（下拉框）统一圆角 */
/* select { border-radius: 10px; } */
/* 复选框勾选颜色（各 App 默认不一样：微信绿 / 删除红…这里统一改） */
/* input[type='checkbox'] { accent-color: #07C160; } */

/* ── 79. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 80. 文字选中（长按 / 拖选文字的高亮色） ── */
/* 解开注释填你想要的颜色 */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 81. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 十一、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 发送键换个颜色 */
/* [data-testid='wx-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** QQ · 模板：QQ 所有界面逐项列出——聊天界面（气泡/输入栏/按钮/图标/面板/菜单）、
 *  聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）、红包·亲属卡页面、
 *  消息界面 / 联系人 / 动态(空间) / 个人中心 / 聊天设置 / 手机壳与公共。 */
export const QQ_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: 'QQ全部界面：聊天 / 卡片 / 红包页 / 动态 / 个人中心 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   QQ · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 聊天界面（气泡/输入栏/按钮/图标/面板/菜单）
   二 聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）
   三 红包/亲属卡页面  四 消息(QQ主页)界面
   五 联系人  六 动态(空间)  七 个人中心
   八 聊天设置  九 手机壳与公共。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   两个提醒：① 聊天页灰白底（#F5F6F7）与其他 App 共用，
   在「手机壳与公共 › 页面背景」统一改；② 我的气泡和发送键
   颜色是程序内联写死的，规则带 !important 才能盖住——保留，别删。 */

/* ══ 一、聊天界面（所有 QQ 联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 2. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.qq-topbar button { color: inherit; }
/* 想固定图标颜色？把上面那行换成下面两行 */
/* .qq-topbar button { color: #1F2329; } */
/* .dark & .qq-topbar button { color: #FFFFFF; } */

/* ── 3. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine { background: #0099FF !important; color: #FFFFFF; }
/* 想让深色模式换个颜色？解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 4. 对方的气泡（左侧白泡） ── */
.qq-bub-theirs { background: #FFFFFF !important; color: #1F2329; }
.dark & .qq-bub-theirs { background: #2A2C31 !important; color: #FFFFFF; }

/* ── 5. 时间胶囊（居中的时间小条） ── */
.qq-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .qq-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 6. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 引用条（回复时输入框上方那条白条） ── */
[data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 9. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 10. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ── 11. 输入框（打字的浅灰圆角框） ── */
[data-testid='qq-chat-input'] {
  background: #F6F7F8;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & [data-testid='qq-chat-input'] {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 12. 表情按钮（输入栏的笑脸图标；展开时变 QQ 蓝是程序控制） ── */
[data-testid='qq-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 13. 加号按钮（更多功能那个＋图标；展开时旋转 45°） ── */
[data-testid='qq-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 14. 发送按钮（QQ 蓝圆角按钮；颜色程序内联 → 带 !important） ── */
[data-testid='qq-chat-send'] { background: #12B7F5 !important; color: #FFFFFF; }

/* ── 15. 加号面板（相册/转账/位置…展开层；默认主题贴着输入栏） ── */
[data-testid='qq-plus-panel'] { border-color: rgba(0, 0, 0, 0.05); }
.dark & [data-testid='qq-plus-panel'] { border-color: rgba(255, 255, 255, 0.06); }

/* ── 16. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='qq-sticker-panel'] { background: #FFFFFF; }
.dark & [data-testid='qq-sticker-panel'] { background: #1B1C1F; }

/* ── 17. 多选栏按钮（长按消息进入多选：转发 / 收藏；图标跟色）
   与删除键（红字红图标） ── */
[data-testid='qq-select-del'] { color: #F5455C; }

/* ── 18. 右上菜单按钮（聊天页顶部的 ⋯ 图标） ── */
[data-testid='qq-chat-menu'] { color: inherit; }

/* ══ 二、聊天卡片（QQ 无小尾巴、无礼物卡） ══ */

/* ── 19. 所有卡片的圆角（QQ 大圆角） ── */
.chat-card-body { border-radius: 12px; }

/* ── 20. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 21. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 22. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 23. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 24. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 25. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 26. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 27. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 28. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 29. 卡片横幅（代付卡顶部的彩色横条） ── */
.chat-card-banner { border-radius: 10px; }

/* ── 30. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 31. 卡片底部标签条（QQ红包/转账/亲属卡那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 32. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 33. 卡片里的图标（红包铜钱/礼物盒…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card svg { color: #FFE9B8; } */

/* ══ 三、红包 / 亲属卡页面 ══ */

/* ── 34. 开红包按钮（红包封面上的金色圆钮「開」） ── */
[data-testid='qq-rp-open'] { background: #FBE7B2; color: #D8332F; }

/* ── 35. 红包详情金额（点开红包后的大字金额，浅金色） ── */
[data-testid='qq-rp-detail-amount'] { color: #FFE9B8; }

/* ── 36. 亲属卡详情卡（金色渐变卡身；程序内联 → 带 !important） ── */
[data-testid='qq-family-detail-card'] {
  background: linear-gradient(150deg, #F7D488 0%, #EDB95E 60%, #E3A94B 100%) !important;
}

/* ══ 四、消息界面（QQ 主页） ══ */

/* ── 37. QQ 主界面底色（QQ 特有的冷灰白，与微信的 #EDEDED 各改各的） ── */
.qq-root { background: #FAFAFC; }
.dark & .qq-root { background: #16171A; }

/* ── 38. 页面头部（头像 + 大标题那一行；默认透明贴着页面底色） ── */
/* .qq-head { background: #FAFAFC; } */

/* ── 39. 搜索框胶囊 ── */
.qq-search { background: rgba(0, 0, 0, 0.05); }
.dark & .qq-search { background: rgba(255, 255, 255, 0.08); }

/* ── 40. 会话行（默认透明，置顶行浅灰） ── */
.qq-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .qq-session-row { background: #F0F1F5 !important; } */
/* .dark & .qq-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 41. 未读角标（红色数字） ── */
[data-testid^='qq-unread-badge-'],
[data-testid='qq-tab-badge-消息'],
[data-testid='qq-tab-badge-动态'],
[data-testid='qq-discover-zone-badge'] { background: #F5455C; }

/* ── 42. 右上角＋菜单（消息页的下拉小面板） ── */
[data-testid='qq-msgs-plus-menu'] { background: #FFFFFF; }
.dark & [data-testid='qq-msgs-plus-menu'] { background: #2A2C31; }

/* ── 43. 长按会话菜单（置顶/删除那个白条菜单） ── */
[data-testid='qq-session-ctx'] {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.08);
}
.dark & [data-testid='qq-session-ctx'] {
  background: rgba(76, 76, 76, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 44. 底部标签栏（消息 / 联系人 / 动态） ── */
.qq-tabbar {
  background: #FFFFFF;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .qq-tabbar {
  background: #1B1C1F;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 45. 标签按钮与图标（未选中字色图标色一起换；
   选中色是程序控制的 QQ 蓝） ── */
[data-testid^='qq-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 五、联系人界面 ══ */

/* ── 46. 分组标签（分组 / 好友 / 群聊那排；选中色是程序控制的 QQ 蓝） ── */
[data-testid^='qq-ct-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-ct-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ── 47. 好友行（我的好友列表里的行；默认透明） ── */
.qq-contact-row { background: transparent; }

/* ── 48. 添加入口（新的朋友 / 添加好友那两颗） ──
   [data-testid='qq-contacts-add'] 与 [data-testid='qq-contacts-newfriends'] */

/* ══ 六、动态界面（QQ 空间） ══ */

/* ── 49. 动态入口行（好友动态 / 相册 / 日历…；默认透明） ── */
[data-testid^='qq-discover-'] { background: transparent; }

/* ── 50. 空间动态流（说说的滚动区域；默认透明） ── */
[data-testid='qq-zone-feed'] { background: transparent; }

/* ── 51. 空间小红点（好友动态入口的未读点） ── */
[data-testid='qq-discover-zone-badge'] { background: #F5455C; }

/* ══ 七、个人中心（QQ 的「我」） ══ */

/* ── 52. 侧边抽屉头像（左上头像点开的抽屉里那颗） ── */
[data-testid='qq-drawer-avatar'] { border-radius: 999px; }

/* ── 53. 抽屉里的名字 ── */
[data-testid='qq-drawer-name'] { color: inherit; }

/* ── 54. 切换账号按钮（名字下面那个空心小胶囊） ── */
[data-testid='qq-drawer-switch'] {
  border-color: rgba(0, 0, 0, 0.12);
  color: rgba(0, 0, 0, 0.6);
}
.dark & [data-testid='qq-drawer-switch'] {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 55. 抽屉功能行图标（相册黄 / 收藏·表情·钱包蓝 / 个性装扮粉；
   颜色程序内联——想统一改色解开注释） ── */
/* [data-testid='qq-drawer'] ~ * svg { color: #3BA0FF; } */

/* ── 56. 个人资料页（头像 / 签名 / QQ号） ──
   [data-testid='qq-profile-avatar'] / [data-testid='qq-profile-sign'] /
   [data-testid='qq-profile-qqid'] */

/* ── 57. 好友资料页（点头像进入：点赞 / 留言 / 空间那排） ──
   [data-testid='qq-fprofile-like'] / [data-testid='qq-fprofile-message'] /
   [data-testid='qq-fprofile-zone'] */

/* ══ 八、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 58. 设置页底色（备注/主题/翻译那页；微信/信息不受影响） ── */
.chat-set-page[data-chat-set-app='qq'][class*='bg-[#F5F6F8]'] { background: #F5F6F8; }
.dark & .chat-set-page[data-chat-set-app='qq'][class*='bg-[#F5F6F8]'] { background: #16171A; }

/* ── 59. 设置卡（圆角 14px 大圆角卡 = QQ 的） ── */
.chat-set-page[data-chat-set-app='qq'] .chat-set-card[class*='rounded-[14px]'] { background: #FFFFFF; }
.dark & .chat-set-page[data-chat-set-app='qq'] .chat-set-card[class*='rounded-[14px]'] { background: #232529; }

/* ── 60. 设置行（备注 / 主题 / 翻译…；默认透明） ── */
.chat-set-page[data-chat-set-app='qq'] .chat-set-row { background: transparent; }

/* ══ 九、手机壳与公共（所有 App 共用部分） ══ */

/* ── 61. 状态栏（顶部时间 · 信号 · 电池；默认自动黑/白） ── */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 62. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 63. Home 指示条（屏幕最底部的小横杠；默认自动黑/白） ── */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 64. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;
}

/* ── 65. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}

/* ── 66. 面板与卡片（设置页 · 弹窗 · 主题面板） ── */
.rt-panel { background: #FFFFFF; }
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 67. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* input, textarea { caret-color: #FF7A59; } */
/* select { border-radius: 10px; } */
/* input[type='checkbox'] { accent-color: #0099FF; } */

/* ── 68. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 69. 文字选中（长按 / 拖选文字的高亮色） ── */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 70. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 十、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .qq-bub-mine, .qq-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .qq-chat-list { font-size: 17px; } */

/* 发送键换个颜色 */
/* [data-testid='qq-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .qq-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 信息 · 模板：信息 App（iMessage 风）所有界面逐项列出——会话列表 / 联系人 /
 *  聊天界面（顶栏/气泡/尾巴/系统消息/引用条/输入栏/加号面板/多选栏/图标）/
 *  聊天设置 / 手机壳与公共。 */
export const SMS_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '信息全部界面：会话列表 / 联系人 / 聊天 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   信息 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 会话列表  二 联系人  三 聊天界面
   四 聊天设置  五 手机壳与公共。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   两个提醒：① 信息 App 的页面底色跟系统走，在「手机壳与
   公共 › 页面背景」统一改；② 气泡若装扮过（纯色/七彩），
   颜色是程序写死的，规则里的 !important 用来盖住——保留。 */

/* ══ 一、会话列表界面（信息 Tab） ══ */

/* ── 1. 会话行（小助手 / 好友；默认透明，置顶行浅灰） ── */
.sms-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .sms-session-row { background: rgba(0, 0, 0, 0.06) !important; } */
/* .dark & .sms-session-row { background: rgba(255, 255, 255, 0.08) !important; } */

/* ── 2. 匿名号码按钮（右上角眼睛图标） ── */
[data-testid='chat-list-anon'] { color: hsl(var(--muted-foreground)); }

/* ── 3. 未读角标（红色数字） ── */
[data-testid='sms-unread-badge'] { background: #FF3B30; }

/* ── 4. 底部分段栏（信息 / 联系人 胶囊那一栏；毛玻璃半透） ── */
.sms-tabbar { background: rgba(255, 255, 255, 0.6); }
.dark & .sms-tabbar { background: rgba(255, 255, 255, 0.06); }
/* 分段的选中胶囊是 iOS 蓝（#007AFF），由程序控制 */

/* ── 5. 分段按钮（信息 / 联系人 两颗字；未选中灰、选中白） ── */
.sms-tabbar [role='tab'] { color: hsl(var(--muted-foreground)); }

/* ══ 二、联系人界面（信息 App 联系人 Tab） ══ */

/* ── 6. 联系人行（与信息行共用锚点 .sms-session-row，见 1） ── */

/* ── 7. 搜索框（联系人页顶部那个圆角搜索条） ── */
input[aria-label='搜索联系人'] {
  background: transparent;
  color: inherit;
}

/* ══ 三、聊天界面 ══ */

/* ── 8. 顶部栏（返回 + 头像/手机号 + 设置钮；毛玻璃半透） ── */
.sms-topbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-topbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 9. 顶部栏图标（返回箭头 / ⋯ 设置钮；颜色跟系统文字色） ── */
.sms-topbar button { color: hsl(var(--foreground)); }

/* ── 10. 我的气泡（右侧 iOS 蓝泡；文字和语音一起换） ── */
.sms-bub-mine { background: #007AFF !important; color: #FFFFFF; }

/* ── 11. 对方的气泡（左侧灰泡） ── */
.sms-bub-theirs { background: hsl(var(--muted)) !important; color: hsl(var(--foreground)); }

/* ── 12. 气泡小尾巴（跟气泡同色的弯钩） ── */
.sms-bub-tail-mine { background: #007AFF !important; }
.sms-bub-tail-theirs { background: hsl(var(--muted)) !important; }

/* ── 13. 系统消息（居中提示胶囊） ── */
[data-testid='sms-sys-row'] span {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.55);
}
.dark & [data-testid='sms-sys-row'] span {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 14. 撤回提示（居中的「撤回一条消息」胶囊） ── */
[data-testid='sms-recall-row'] span {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.55);
}
.dark & [data-testid='sms-recall-row'] span {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 15. 引用条（回复时输入框上方那条；文字灰） ── */
[data-testid='sms-quote-bar'] { color: hsl(var(--muted-foreground)); }

/* ── 16. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 17. 底部输入栏（加号 + 输入胶囊 + 麦克风；毛玻璃半透） ── */
.sms-inputbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-inputbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 18. 输入胶囊（打字的白色圆角条） ── */
.sms-inputbar input { background: transparent; color: inherit; }
/* 想改打字光标颜色？解开下面这行 */
/* .sms-inputbar input { caret-color: #FF7A59; } */

/* ── 19. 加号按钮（输入栏左侧的灰圆钮＋图标） ── */
[data-testid='sms-plus-button'] {
  background: rgba(255, 255, 255, 0.6);
  color: hsl(var(--muted-foreground));
}
.dark & [data-testid='sms-plus-button'] {
  background: rgba(255, 255, 255, 0.08);
}

/* ── 20. 语音按钮（声波图标；开启录音时变 iOS 蓝） ── */
[data-testid='sms-voice-toggle'] { color: hsl(var(--muted-foreground)); }

/* ── 21. 麦克风按钮（文字转语音开关；开启时变 iOS 蓝） ── */
[data-testid='sms-tts-toggle'] { color: hsl(var(--muted-foreground)); }

/* ── 22. 加号面板（相机 / 图片 / 文字图片 展开层；毛玻璃半透） ── */
[data-testid='sms-plus-panel'] {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & [data-testid='sms-plus-panel'] {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 23. 多选栏（长按消息进入多选后的底部一排；毛玻璃半透） ── */
[data-testid='sms-select-bar'] {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & [data-testid='sms-select-bar'] {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 24. 文字图片创建层（底部弹起的白色面板 + 黑遮罩） ── */
[data-testid='sms-textcard-sheet'] { background: rgba(0, 0, 0, 0.45); }
[data-testid='sms-textcard-sheet'] > div {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.7);
}
.dark & [data-testid='sms-textcard-sheet'] > div {
  background: rgba(28, 28, 30, 0.85);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ══ 四、聊天设置界面（iOS 风：跟系统底色走） ══ */

/* ── 25. 设置页底色（备注/主题/翻译那页；跟随系统深浅） ── */
.chat-set-page[data-chat-set-app='sms'][class*='bg-background'] { background: hsl(var(--background)); }

/* ── 26. 设置卡（半透明 iOS 圆角卡，圆角 14px） ── */
.chat-set-page[data-chat-set-app='sms'] .chat-set-card {
  background: rgba(0, 0, 0, 0.045);
}
.dark & .chat-set-page[data-chat-set-app='sms'] .chat-set-card {
  background: rgba(255, 255, 255, 0.08);
}

/* ── 27. 设置行（备注 / 主题 / 翻译 / 回复条数…；默认透明） ── */
.chat-set-page[data-chat-set-app='sms'] .chat-set-row { background: transparent; }

/* ── 28. 消息翻译行 / 文字转语音开关 ──
   [data-testid='sms-translate-row'] 与 [data-testid='sms-tts-toggle'] */

/* ══ 五、手机壳与公共（所有 App 共用部分） ══ */

/* ── 29. 状态栏（顶部时间 · 信号 · 电池；默认自动黑/白） ── */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 30. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 31. Home 指示条（屏幕最底部的小横杠；默认自动黑/白） ── */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 32. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;
}

/* ── 33. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}

/* ── 34. 面板与卡片（设置页 · 弹窗 · 主题面板） ── */
.rt-panel { background: #FFFFFF; }
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 35. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* input, textarea { caret-color: #FF7A59; } */
/* select { border-radius: 10px; } */
/* input[type='checkbox'] { accent-color: #007AFF; } */

/* ── 36. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 37. 文字选中（长按 / 拖选文字的高亮色） ── */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 38. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 六、再动手？解开这些注释 ══ */

/* 聊天文字放大一档 */
/* .sms-chat-list { font-size: 17px; } */

/* 气泡圆角改小一点 */
/* .sms-bub-mine, .sms-bub-theirs { border-radius: 12px; } */

/* 我的气泡换个颜色（iOS 蓝改薄荷绿） */
/* .sms-bub-mine { background: #63E6BE !important; color: #00332B !important; } */
/* .sms-bub-tail-mine { background: #63E6BE !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .sms-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

// ================= 聊天（联系人 › 聊天设置 › 自定义CSS） =================
// 第七十七轮（用户指定）：聊天编辑器与主题页编辑器同款体验——一份「模板」全量列出：
// 背景顶栏 / 气泡尾巴 / 时间撤回系统引用 / 状态卡片 / 输入栏与全部按钮图标 /
// 加号表情面板 / 多选栏 / 红包转账亲属卡礼物代付外卖全部卡片，一段一处。

/** 微信 · 聊天模板（联系人专属）：该联系人聊天页的全部元素清单 */
const WX_CHAT_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '聊天页全部：气泡 / 卡片 / 按钮 / 图标 / 面板',
  css: `/* ═══════════════════════════════════════════════
   微信 · 聊天模板（联系人专属 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页（其他联系人、
   消息列表、朋友圈等界面都不受影响）。
   一 聊天界面（背景/顶栏/气泡/输入栏/按钮/图标）
   二 聊天卡片（红包/转账/亲属卡/礼物/代付…一张一段）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值（想让深浅不一样才留它）。
   图标（返回箭头/笑脸/＋/发送…）是 SVG 线条，颜色跟着
   所在按钮的文字色（color）走——改按钮 color 图标就变。
   装扮气泡（纯色/七彩/古早/液态）自带样式，不吃这套规则；
   聊天设置里设过纯色/图片背景时，背景层会盖在第 1 段上面。 */

/* ══ 一、聊天界面 ══ */

/* ── 1. 聊天页背景 ── */
& { background: #EDEDED; }
.dark & { background: #111111; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 3. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.wx-topbar button { color: #000000; }
.dark & .wx-topbar button { color: #FFFFFF; }

/* ── 4. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine {
  background: #95EC69 !important;   /* 微信绿 */
  color: #000000;
}
.dark & .wx-bub-mine {
  background: #3EB575 !important;
  color: #000000;
}

/* ── 5. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.wx-bub-theirs {
  background: #FFFFFF !important;
  color: #000000;
}
.dark & .wx-bub-theirs {
  background: #1E1E1E !important;
  color: #FFFFFF;
}

/* ── 6. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 7. 时间胶囊（居中的时间小条） ── */
.wx-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .wx-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 9. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 10. 引用条（回复时输入框上方那条白条） ── */
[data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 11. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 12. 底部输入栏（打字那一栏） ── */
.wx-inputbar {
  background: #EDEDED;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & .wx-inputbar {
  background: #111111;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 13. 输入框（打字的白色方框；光标是微信绿） ── */
[data-testid='wx-chat-input'] { background: #FFFFFF; }
.dark & [data-testid='wx-chat-input'] { background: #232323; }

/* ── 14. 语音按钮（输入栏最左的圆圈钮＋声波图标） ── */
[data-testid='wx-voice-toggle'] > span {
  border-color: rgba(0, 0, 0, 0.85);
  color: rgba(0, 0, 0, 0.9);
}
.dark & [data-testid='wx-voice-toggle'] > span {
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(255, 255, 255, 0.9);
}

/* ── 15. 表情按钮（输入栏的笑脸图标） ── */
[data-testid='wx-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 16. 加号按钮（更多功能那个＋图标） ── */
[data-testid='wx-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 17. 麦克风按钮（输入框里的文字转语音开关；开启时变微信绿） ── */
[data-testid='wx-tts-toggle'] { color: rgba(0, 0, 0, 0.4); }
.dark & [data-testid='wx-tts-toggle'] { color: rgba(255, 255, 255, 0.4); }

/* ── 18. 发送按钮（右侧绿色按钮） ── */
[data-testid='wx-chat-send'] { background: #07C160; color: #FFFFFF; }
[data-testid='wx-chat-send']:active { background: #06AD56; }

/* ── 19. 加号面板（相册/转账/位置/线下…展开层） ── */
[data-testid='wx-plus-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-plus-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 20. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='wx-sticker-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-sticker-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 21. 多选栏按钮（长按消息进入多选：转发 / 收藏；图标跟色） ── */
[data-testid='wx-select-forward'],
[data-testid='wx-select-fav'] { color: rgba(0, 0, 0, 0.75); }
.dark & [data-testid='wx-select-forward'],
.dark & [data-testid='wx-select-fav'] { color: rgba(255, 255, 255, 0.75); }

/* ── 22. 多选栏删除键（红字红图标） ── */
[data-testid='wx-select-del'] { color: #FA5151; }

/* ══ 二、聊天卡片（一段一张） ══ */

/* ── 23. 所有卡片的圆角（微信小方角） ── */
.chat-card-body { border-radius: 4px; }

/* ── 24. 红包卡（红橙渐变 + 小尾巴） ── */
.chat-card-rp .chat-card-body {
  background: linear-gradient(135deg, #F2694C, #E94E38) !important;
}
.chat-card-rp .chat-card-tail { background: #EC5A42 !important; }

/* ── 25. 转账卡（橙色渐变 + 小尾巴） ── */
.chat-card-tr .chat-card-body {
  background: linear-gradient(135deg, #F6AC3D, #EF9A2E) !important;
}
.chat-card-tr .chat-card-tail { background: #F2A233 !important; }

/* ── 26. 亲属卡（米白卡身 + 小尾巴） ── */
.chat-card-fam .chat-card-body { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-body { background: #1E1E1E; }
.chat-card-fam .chat-card-tail { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-tail { background: #1E1E1E; }

/* ── 27. 礼物卡（深蓝星空 + 小尾巴） ── */
.chat-card-gift .chat-card-body {
  background: linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%) !important;
}
.chat-card-gift .chat-card-tail { background: #2C4E92 !important; }

/* ── 28. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 29. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 30. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 31. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 32. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 33. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 34. 卡片横幅（代付卡顶部的彩色横条；默认方角贴卡） ── */
.chat-card-banner { border-radius: 0; }

/* ── 35. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 36. 卡片底部标签条（红包/转账/亲属卡/礼物那行小字） ── */
.chat-card-label { color: rgba(255, 255, 255, 0.9); font-size: 12px; }

/* ── 37. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 38. 卡片里的图标（红包铜钱/礼物盒/外卖袋…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card-body svg { color: #FFE9B8; } */

/* ══ 三、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 消息区左右留窄一点 */
/* .wx-chat-list { padding-left: 10px; padding-right: 10px; } */

/* 发送键换个颜色 */
/* [data-testid='wx-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** QQ · 聊天模板（联系人专属）：该联系人聊天页的全部元素清单 */
const QQ_CHAT_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '聊天页全部：气泡 / 卡片 / 按钮 / 图标 / 面板',
  css: `/* ═══════════════════════════════════════════════
   QQ · 聊天模板（联系人专属 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页。
   一 聊天界面（背景/顶栏/气泡/输入栏/按钮/图标）
   二 聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是 QQ 现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   特别说明：我的气泡和发送键颜色是程序内联写死的，
   模板里那两条规则带了 !important 才能盖住——保留它，别删。 */

/* ══ 一、聊天界面 ══ */

/* ── 1. 聊天页背景 ── */
& { background: #F5F6F7; }
.dark & { background: #111214; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 3. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.qq-topbar button { color: inherit; }
/* 想固定图标颜色？把上面那行换成下面两行 */
/* .qq-topbar button { color: #1F2329; } */
/* .dark & .qq-topbar button { color: #FFFFFF; } */

/* ── 4. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine {
  background: #0099FF !important;   /* QQ 蓝（深浅模式同色） */
  color: #FFFFFF;
}
/* 想让深色模式换个颜色，解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 5. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.qq-bub-theirs {
  background: #FFFFFF !important;
  color: #1F2329;
}
.dark & .qq-bub-theirs {
  background: #2A2C31 !important;
  color: #FFFFFF;
}

/* ── 6. 时间胶囊（居中的时间小条） ── */
.qq-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .qq-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 9. 引用条（回复时输入框上方那条白条） ── */
[data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 10. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 11. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ── 12. 输入框（打字的浅灰圆角框） ── */
[data-testid='qq-chat-input'] {
  background: #F6F7F8;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & [data-testid='qq-chat-input'] {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 13. 表情按钮（输入栏的笑脸图标；展开时变 QQ 蓝是程序控制） ── */
[data-testid='qq-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 14. 加号按钮（更多功能那个＋图标；展开时旋转 45°） ── */
[data-testid='qq-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 15. 发送按钮（QQ 蓝圆角按钮；颜色程序内联 → 带 !important） ── */
[data-testid='qq-chat-send'] { background: #12B7F5 !important; color: #FFFFFF; }

/* ── 16. 加号面板（相册/转账/位置…展开层；默认主题贴着输入栏） ── */
[data-testid='qq-plus-panel'] { border-color: rgba(0, 0, 0, 0.05); }
.dark & [data-testid='qq-plus-panel'] { border-color: rgba(255, 255, 255, 0.06); }

/* ── 17. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='qq-sticker-panel'] { background: #FFFFFF; }
.dark & [data-testid='qq-sticker-panel'] { background: #1B1C1F; }

/* ── 18. 多选栏删除键（长按消息进入多选后的红字红图标） ── */
[data-testid='qq-select-del'] { color: #F5455C; }

/* ── 19. 右上菜单按钮（聊天页顶部的 ⋯ 图标） ── */
[data-testid='qq-chat-menu'] { color: inherit; }

/* ══ 二、聊天卡片（QQ 无小尾巴、无礼物卡） ══ */

/* ── 20. 所有卡片的圆角（QQ 大圆角） ── */
.chat-card-body { border-radius: 12px; }

/* ── 21. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 22. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 23. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 24. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 25. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 26. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 27. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 28. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 29. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 30. 卡片横幅（代付卡顶部的彩色横条） ── */
.chat-card-banner { border-radius: 10px; }

/* ── 31. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 32. 卡片底部标签条（QQ红包/转账/亲属卡那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 33. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 34. 卡片里的图标（红包铜钱/礼物盒…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card svg { color: #FFE9B8; } */

/* ══ 三、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .qq-bub-mine, .qq-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .qq-chat-list { font-size: 17px; } */

/* 发送键换个颜色 */
/* [data-testid='qq-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .qq-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 聊天模板组（「模板」chips 按此列出）：微信 / QQ 各一份全量模板 */
export function chatCssTemplates(app: 'wx' | 'qq'): CssTemplate[] {
  return app === 'qq' ? [QQ_CHAT_TEMPLATE] : [WX_CHAT_TEMPLATE];
}

// ================= 线下（线下模式 › 现场设置 › 自定义CSS） =================

/** 线下 · 模板：线下模式所有界面逐项列出（开始页 / 见面页 / 存档面板 / 现场设置 /
 *  历史记录 + 全部按钮与图标），默认值 = 默认毛玻璃皮肤当前样式。 */
export const OFFLINE_CSS_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '线下全部界面：开始页 / 见面页 / 存档 / 设置 / 历史 / 图标',
  css: `/* ═══════════════════════════════════════════════
   线下模式 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：线下模式的所有界面，按界面分节：
   一 全部界面共用（卡片/按钮/输入框/图标）
   二 开始页  三 见面页  四 存档面板
   五 现场设置面板  六 过去的见面（历史）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的是线下界面现在的默认样式（毛玻璃）——
   不改直接应用 ≈ 没变化。成对的两行里，第二行是深色
   模式的值（想让深浅不一样才留它）。
   图标（返回箭头/收藏星/存档箱/滑杆/旋转/发送…）是
   SVG 线条，颜色跟着所在按钮的文字色（color）走。 */

/* ══ 一、全部界面共用 ══ */

/* ── 1. 页面底色（开始页/见面页/各面板的底） ── */
& { background: #F3F1EE; }
.dark & { background: #0C0C0E; }

/* ── 2. 卡片（AI 叙事卡 / 信息卡 / 存档卡 / 历史卡） ── */
.off-card {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .off-card {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 3. 顶部小按钮（返回 / 收藏 / 存档 / 现场设置四颗圆钮，
   图标跟按钮文字色一起换） ── */
.off-chip {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(0, 0, 0, 0.6);
}
.dark & .off-chip {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 4. 主按钮（新建 / 保存 / 确认那类深色实心钮） ── */
.off-btn-primary { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-btn-primary { background: #FFFFFF; color: #000000; }

/* ── 5. 幽灵按钮（取消 / 过去的见面 那类空心钮） ── */
.off-btn-ghost {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(0, 0, 0, 0.6);
}
.dark & .off-btn-ghost {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 6. 输入框（表单 · 聊天输入条） ── */
.off-input {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.7);
}
.dark & .off-input {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 7. 发送按钮（输入条里的深色圆钮＋上箭头） ── */
.off-send { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-send { background: #FFFFFF; color: #000000; }

/* ── 8. 标题区（顶部头像 + 名字 + 日期那一块） ── */
.off-title { color: inherit; }

/* ══ 二、开始页（还没点「开始见面」时） ══ */

/* ── 9. 开始页中心区（大头像 + 名字 + 按钮那块；默认透明） ── */
.off-hero { background: transparent; }

/* ── 10. 开始见面按钮（深色大按钮＋星图标） ── */
.off-start { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-start { background: #FFFFFF; color: #000000; }

/* ── 11. 过去的见面按钮（历史入口，幽灵样式＋时钟图标） ── */
[data-testid='offline-history-open'] { color: rgba(0, 0, 0, 0.6); }
.dark & [data-testid='offline-history-open'] { color: rgba(255, 255, 255, 0.6); }

/* ══ 三、见面页（见面进行中） ══ */

/* ── 12. 消息流（叙事卡 + 你的气泡滚动的区域；默认透明） ── */
.off-feed { background: transparent; }

/* ── 13. AI 叙事卡（对方说的话；样式 = 共用 .off-card，见 2） ── */

/* ── 14. 我的气泡（见面页里你说的话） ── */
.off-bubble-user {
  background: rgba(236, 234, 231, 0.85);
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .off-bubble-user {
  background: rgba(44, 44, 46, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 15. 底部输入区（继续/重Roll 圆钮 + 输入条 + 发送；默认透明） ── */
.off-dock { background: transparent; }

/* ── 16. 继续 / 重Roll 圆钮（输入条左边两颗；图标跟色） ── */
[data-testid='offline-continue'],
[data-testid='offline-reroll'] { color: rgba(0, 0, 0, 0.75); }
.dark & [data-testid='offline-continue'],
.dark & [data-testid='offline-reroll'] { color: rgba(255, 255, 255, 0.8); }

/* ══ 四、存档面板（顶部「存档」按钮进入） ══ */

/* ── 17. 存档面板底色 ── */
.off-panel-archive { background: #F3F1EE; }
.dark & .off-panel-archive { background: #0C0C0E; }

/* ── 18. 新建存档 / 存档卡 / 导入按钮 ──
   卡片样式 = 共用 .off-card（见 2）；按钮 = .off-btn-primary / .off-btn-ghost（见 4、5） */

/* ══ 五、现场设置面板（顶部「滑杆」按钮进入） ══ */

/* ── 19. 现场设置面板底色 ── */
.off-panel-settings { background: #F3F1EE; }
.dark & .off-panel-settings { background: #0C0C0E; }

/* ── 20. 放弃见面按钮（设置里那颗红色的） ──
   [data-testid='offline-abandon'] { color: #FF3B30; } */

/* ══ 六、过去的见面（历史记录） ══ */

/* ── 21. 历史页底色 ── */
.off-panel-history { background: #F3F1EE; }
.dark & .off-panel-history { background: #0C0C0E; }

/* ── 22. 历史里的见面卡（样式 = 共用 .off-card，见 2） ── */

/* ── 23. 再动手？解开这些注释 ── */
/* 卡片圆角改小 */
/* .off-card { border-radius: 12px; } */

/* 开始见面按钮改渐变色 */
/* .off-start { background: linear-gradient(180deg, #97CC58 0%, #71A83B 100%); color: #fff; } */

/* 叙事文字放大一档 */
/* .off-card { font-size: 15.5px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 全局模板组（个性装扮 › 自定义CSS Tab）：每个 App 只显示自己的一份「模板」
 *  （第七十六轮按 App 分开；第七十七轮用户指定：手机公共模板删除，
 *  公共部分并入各 App 模板的「手机壳与公共」一节）。 */
export function globalCssTemplates(app: 'wx' | 'qq' | 'sms'): CssTemplate[] {
  if (app === 'wx') return [WX_APP_TEMPLATE];
  if (app === 'qq') return [QQ_APP_TEMPLATE];
  return [SMS_APP_TEMPLATE];
}

/** 线下模板组（线下模式 › 现场设置）：一份「模板」含全部 */
export const OFFLINE_CSS_TEMPLATES: CssTemplate[] = [OFFLINE_CSS_TEMPLATE];
