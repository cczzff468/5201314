/**
 * 聊天输入框自定义（微信 / QQ 两 App 隔离；信息 App 不接入——用户指定）——核心库
 * ---------------------------------------------------------------------------
 *
 * 两项自定义（默认 / 液态玻璃两种界面主题下都生效）：
 *   1. 输入框占位文字（inputPlaceholder）：不打字时输入框里显示的灰色文字，
 *      如「♡*·☆ 1314 day with U·+°♡」；空串 = 原生默认（微信/QQ 输入框为空）。
 *      文字转语音开启时仍优先显示「输入文字，发送后转为语音」。
 *   2. 输入框上方快捷功能（quickKeys）：把「+」面板里的功能以小胶囊放到输入框上面，
 *      点一下直接触发（与点加号面板里那一项完全等效）；「+」面板本身保持原样不动
 *      （用户指定「加号面板里面的功能不要动」）；空数组 = 不显示快捷条（原生样子）。
 *
 * 持久化：zustand useSettings → IndexedDB settings.chatDecor（与 bubbleStyle / liquidSkin 分键互不影响）。
 * 兼容：旧档字段 plusKeys（上一版语义=加号面板过滤）自动迁移为 quickKeys（面板恢复原生全部）。
 */
import type { BubbleAppId } from './bubble-style';

/** 接入输入框自定义的 App（信息 App 不接入） */
export type DecorAppId = Exclude<BubbleAppId, 'sms'>;

/** 单个 App 的输入框自定义 */
export interface ChatDecorSettings {
  /** 输入框占位文字（空 = 原生默认；最长 30 字） */
  inputPlaceholder: string;
  /** 输入框上方快捷功能 key 列表（按显示顺序；空 = 不显示快捷条） */
  quickKeys: string[];
}

/** 加号面板功能中文名（设置页「可添加」清单展示用；也是合法 key 的权威清单——面板本身不受影响） */
export const PLUS_FEATURE_LABELS: Record<DecorAppId, Record<string, string>> = {
  wx: {
    camera: '相机',
    image: '图片',
    voicecall: '语音通话',
    videocall: '视频通话',
    redpacket: '红包',
    transfer: '转账',
    location: '位置',
    offline: '线下',
    textcard: '文字图片',
    together: '一起听',
    gift: '礼物',
  },
  qq: {
    call: '语音通话',
    video: '视频通话',
    rp: '红包',
    transfer: '转账',
    loc: '位置',
    textcard: '文字图片',
    together: '一起听',
    express: '快递',
  },
};

/** 设置页「可添加」功能池的展示顺序（与各端加号面板原生顺序一致） */
export const PLUS_POOL_KEYS: Record<DecorAppId, readonly string[]> = {
  wx: ['camera', 'image', 'voicecall', 'videocall', 'redpacket', 'transfer', 'location', 'offline', 'textcard', 'together', 'gift'],
  qq: ['call', 'video', 'rp', 'transfer', 'loc', 'textcard', 'together', 'express'],
};

export const DEFAULT_CHAT_DECOR: ChatDecorSettings = {
  inputPlaceholder: '',
  quickKeys: [],
};

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法设置；不合法回默认 */
export function normalizeChatDecor(v: unknown): ChatDecorSettings {
  const o = (v ?? {}) as Partial<ChatDecorSettings> & { plusKeys?: unknown };
  // 旧档迁移：上一版字段 plusKeys（语义=加号面板过滤）→ 视作用户挑选过的功能，带进快捷条
  const legacy = Array.isArray(o.plusKeys) ? o.plusKeys.filter((k): k is string => typeof k === 'string') : [];
  const quick = Array.isArray(o.quickKeys) ? o.quickKeys.filter((k): k is string => typeof k === 'string') : legacy;
  return {
    inputPlaceholder: typeof o.inputPlaceholder === 'string' ? o.inputPlaceholder.slice(0, 30) : '',
    quickKeys: quick.slice(0, 12),
  };
}

/** 接入 App 全量（仅微信 / QQ；信息 App 不接入） */
export type ChatDecorConfig = Record<DecorAppId, ChatDecorSettings>;

export function defaultChatDecorConfig(): ChatDecorConfig {
  return {
    wx: { ...DEFAULT_CHAT_DECOR },
    qq: { ...DEFAULT_CHAT_DECOR },
  };
}

export function normalizeChatDecorConfig(v: unknown): ChatDecorConfig {
  if (!v || typeof v !== 'object') return defaultChatDecorConfig();
  const o = v as Record<string, unknown>;
  return {
    wx: normalizeChatDecor(o.wx),
    qq: normalizeChatDecor(o.qq),
  };
}

/** 输入框上方快捷功能最终渲染顺序（过滤未知 key；空 = 不显示快捷条）——聊天页直接消费 */
export function resolveQuickKeys(app: DecorAppId, keys: readonly string[]): string[] {
  const known = PLUS_FEATURE_LABELS[app];
  return keys.filter((k) => typeof k === 'string' && k in known);
}

/** 输入框占位文字最终值（空 = 原生默认由调用方处理） */
export function chatPlaceholder(decor: ChatDecorSettings | undefined): string {
  return (decor?.inputPlaceholder ?? '').trim();
}
