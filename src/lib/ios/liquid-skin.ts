/**
 * 液态玻璃主题 · 皮肤自定义（本轮新增）——核心库
 * ---------------------------------------------------------------------------
 * 宿主 App：wx 微信 / qq QQ（sms 无液态主题，不参与）。
 *
 * 用户需求：
 *  1. 聊天页顶栏（液态主题）名字区四种模式：
 *     - text       纯文字名字（现状）
 *     - avatarName 头像 + 名字（名字可关 → 只剩头像）
 *     - dual       双头像（TA 的 + 我的），中间可插自定义文字（可空 = 只有两个头像）
 *     - dualName   双头像 + 中间文字 + TA 的名字
 *  2. 微信会话列表分类标签文字可自定义（空 = 默认 全部/好友/工作/群聊/服务号）
 *  3. 微信会话列表搜索框下可开三个小组件：网易云音乐（装饰性播放器）/ 日历 / 自定义 CSS 内容
 *
 * 持久化：zustand useSettings → IndexedDB settings.liquidSkin（与 bubbleStyle 分键互不影响）。
 */
import type { BubbleAppId } from './bubble-style';

/** 聊天页顶栏名字区模式 */
export type LiquidHeaderMode = 'text' | 'avatarName' | 'dual' | 'dualName';

/** 微信会话列表分类标签（可自定义文字的五个键） */
export type LiquidTabKey = 'all' | 'friends' | 'work' | 'groups' | 'officials';

/** 分类标签默认文字（顺序即渲染顺序） */
export const LIQUID_TABS: readonly { key: LiquidTabKey; fallback: string }[] = [
  { key: 'all', fallback: '全部' },
  { key: 'friends', fallback: '好友' },
  { key: 'work', fallback: '工作' },
  { key: 'groups', fallback: '群聊' },
  { key: 'officials', fallback: '服务号' },
];

/** 单个 App 的液态玻璃皮肤设置 */
export interface LiquidSkinSettings {
  /** 聊天页顶栏名字区模式（默认 text = 现状纯文字） */
  headerMode: LiquidHeaderMode;
  /** 双头像模式中间的自定义文字（空 = 不显示文字，只有两个头像） */
  headerMiddleText: string;
  /** 头像+名字 模式是否显示名字（false = 只显示头像） */
  headerShowName: boolean;
  /** 分类标签自定义文字（wx 专用；空串 = 用默认文字） */
  tabLabels: Record<LiquidTabKey, string>;
  /** 会话列表小组件：网易云音乐 */
  widgetMusic: boolean;
  /** 网易云小组件顶部身份（头像+昵称）跟随微信登录账号（true = 跟随，false = 用自定义） */
  musicFollowWx: boolean;
  /** 网易云小组件自定义昵称（musicFollowWx = false 时生效；空 = 「我」） */
  musicName: string;
  /** 网易云小组件自定义头像 dataURL（musicFollowWx = false 时生效；空 = 渐变默认头像） */
  musicAvatar: string;
  /** 会话列表小组件：日历 */
  widgetCalendar: boolean;
  /** 会话列表小组件：自定义 CSS/HTML 内容 */
  widgetCustom: boolean;
  /** 自定义小组件内容（HTML + <style> 均可） */
  customHtml: string;
}

export const DEFAULT_LIQUID_SKIN: LiquidSkinSettings = {
  headerMode: 'text',
  headerMiddleText: '',
  headerShowName: true,
  tabLabels: { all: '', friends: '', work: '', groups: '', officials: '' },
  widgetMusic: false,
  musicFollowWx: true,
  musicName: '',
  musicAvatar: '',
  widgetCalendar: false,
  widgetCustom: false,
  customHtml: '',
};

/** 顶栏模式中文名（设置页展示用） */
export const LIQUID_HEADER_MODE_LABEL: Record<LiquidHeaderMode, string> = {
  text: '名字',
  avatarName: '头像+名字',
  dual: '双头像',
  dualName: '双头像+名字',
};

/** 顶栏模式一行小注 */
export const LIQUID_HEADER_MODE_DESC: Record<LiquidHeaderMode, string> = {
  text: '纯文字（默认）',
  avatarName: 'TA 的头像，名字可隐藏',
  dual: 'TA+我的头像，中间文字可自定义',
  dualName: '双头像，头像下面各带名字',
};

/**
 * 自定义 CSS 小组件示例（「插入示例」写入编辑框）：
 * 一张可爱的迷你状态卡——渐变字 + 圆角玻璃风，演示 <style> 与标签用法。
 */
export const LIQUID_CUSTOM_WIDGET_EXAMPLE = `<style>
.liquid-demo-card{
  display:flex;align-items:center;gap:12px;
  padding:14px 16px;border-radius:18px;
  background:linear-gradient(135deg,rgba(255,255,255,.85),rgba(255,240,245,.65));
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.9),0 6px 18px rgba(200,109,215,.14);
}
.liquid-demo-ava{
  width:40px;height:40px;border-radius:50%;flex:none;
  background:linear-gradient(135deg,#FE91A6,#AF52DE);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:15px;
  box-shadow:0 3px 8px rgba(175,82,222,.35);
}
.liquid-demo-title{
  font-size:15px;font-weight:700;color:#1c1c1e;letter-spacing:.5px;
}
.liquid-demo-sub{
  margin-top:2px;font-size:11.5px;color:#a78bfa;
}
.liquid-demo-heart{
  margin-left:auto;font-size:20px;
  animation:liquid-demo-beat 1.2s ease-in-out infinite;
}
@keyframes liquid-demo-beat{
  0%,100%{transform:scale(1)}
  30%{transform:scale(1.25)}
}
</style>
<div class="liquid-demo-card">
  <span class="liquid-demo-ava">酱</span>
  <span>
    <div class="liquid-demo-title">今日心情</div>
    <div class="liquid-demo-sub">把喜欢的事情做完，就是了不起的一天</div>
  </span>
  <span class="liquid-demo-heart">💗</span>
</div>`;

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法设置；不合法回默认 */
export function normalizeLiquidSkin(v: unknown): LiquidSkinSettings {
  const o = (v ?? {}) as Partial<LiquidSkinSettings>;
  const mode = o.headerMode;
  const labels = (o.tabLabels ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max = 60): string => (typeof x === 'string' ? x.slice(0, max) : '');
  return {
    headerMode:
      mode === 'avatarName' || mode === 'dual' || mode === 'dualName' ? mode : 'text',
    headerMiddleText: str(o.headerMiddleText, 24),
    headerShowName: o.headerShowName !== false,
    tabLabels: {
      all: str(labels.all, 12),
      friends: str(labels.friends, 12),
      work: str(labels.work, 12),
      groups: str(labels.groups, 12),
      officials: str(labels.officials, 12),
    },
    widgetMusic: o.widgetMusic === true,
    musicFollowWx: o.musicFollowWx !== false,
    musicName: str(o.musicName, 24),
    musicAvatar: typeof o.musicAvatar === 'string' ? o.musicAvatar.slice(0, 500_000) : '',
    widgetCalendar: o.widgetCalendar === true,
    widgetCustom: o.widgetCustom === true,
    customHtml: typeof o.customHtml === 'string' ? o.customHtml.slice(0, 20000) : '',
  };
}

/** 三 App 全量（sms 恒默认，无 UI 入口） */
export type LiquidSkinConfig = Record<BubbleAppId, LiquidSkinSettings>;

export function defaultLiquidSkinConfig(): LiquidSkinConfig {
  return {
    wx: { ...DEFAULT_LIQUID_SKIN, tabLabels: { ...DEFAULT_LIQUID_SKIN.tabLabels } },
    qq: { ...DEFAULT_LIQUID_SKIN, tabLabels: { ...DEFAULT_LIQUID_SKIN.tabLabels } },
    sms: { ...DEFAULT_LIQUID_SKIN, tabLabels: { ...DEFAULT_LIQUID_SKIN.tabLabels } },
  };
}

export function normalizeLiquidSkinConfig(v: unknown): LiquidSkinConfig {
  if (!v || typeof v !== 'object') return defaultLiquidSkinConfig();
  const o = v as Record<string, unknown>;
  return {
    wx: normalizeLiquidSkin(o.wx),
    qq: normalizeLiquidSkin(o.qq),
    sms: normalizeLiquidSkin(o.sms),
  };
}

/** 分类标签生效文字（自定义空串回默认） */
export function liquidTabLabel(skin: LiquidSkinSettings, key: LiquidTabKey): string {
  const custom = skin.tabLabels[key]?.trim();
  return custom || LIQUID_TABS.find((t) => t.key === key)?.fallback || '';
}
