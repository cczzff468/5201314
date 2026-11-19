/**
 * 内置表情「文字代码」体系（微信 / QQ 通用）：
 * - 点面板里的内置表情 → 往输入框插入真实表情图（contentEditable 富文本输入框，见 components/apps/chat-rich-input.tsx），
 *   可与文字混排一起发送；发送时由输入框把表情序列化回文字代码（微信 [微笑] / QQ [微笑]）
 *   （对照真实微信/QQ：内置表情进输入框与文字同发；用户收藏的大表情贴纸仍点选直发）
 * - 消息气泡渲染时把代码还原成表情小图（components/apps/inline-emoji.tsx，统一 22px 内联尺寸）
 * - AI 上下文天然可读（代码即含义），回复里输出同样格式即可发表情（仅限内置清单内的名字）
 * - 名字严格取自 builtin-stickers.ts 内置清单；匹配不到的 [xx] 一律按普通文字渲染
 */

import { BUILTIN_QQ_STICKERS, BUILTIN_WX_STICKERS, builtinStickersOf } from './builtin-stickers';

export type EmojiCodeApp = 'wx' | 'qq';

/** app → 名字/URL 映射（模块级惰性构建一次；内置清单是静态常量，永不变化） */
const CODE_MAPS: Record<EmojiCodeApp, Map<string, string>> = {
  wx: new Map(BUILTIN_WX_STICKERS.map((s) => [s.meaning, s.url])),
  qq: new Map(BUILTIN_QQ_STICKERS.map((s) => [s.meaning, s.url])),
};

/** [微笑] 文字代码（名字不含方括号，最长 12 字防止误吞长句括号） */
const EMOJI_CODE_RE = /\[([^\[\]]{1,12})\]/g;

export interface EmojiCodePart {
  type: 'text' | 'emoji';
  /** type=text 时的原文片段 */
  text?: string;
  /** type=emoji 时的表情名字（不带方括号） */
  name?: string;
  /** type=emoji 时的图片地址 */
  url?: string;
}

/**
 * 把消息文本按内置表情代码切分成片段：
 * 「你好[微笑]」→ [{text:'你好'}, {emoji 微笑}]；代码名不在内置清单 → 按普通文字保留
 */
export function splitEmojiCodes(app: EmojiCodeApp, text: string): EmojiCodePart[] {
  if (!text) return [];
  const map = CODE_MAPS[app];
  const parts: EmojiCodePart[] = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_CODE_RE)) {
    const name = m[1];
    const url = map.get(name);
    if (!url) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push({ type: 'text', text: text.slice(last, start) });
    parts.push({ type: 'emoji', name, url });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

/** 消息是否为「纯内置表情」（只由表情代码与空白组成，无其它文字）——气泡里放大渲染 */
export function isPureEmojiCodes(app: EmojiCodeApp, text: string): boolean {
  if (!text.trim()) return false;
  let sawEmoji = false;
  for (const part of splitEmojiCodes(app, text)) {
    if (part.type === 'emoji') {
      sawEmoji = true;
      continue;
    }
    if (part.text?.trim()) return false;
  }
  return sawEmoji;
}

/** 剥掉全部内置表情代码（表情包开关关闭时对 AI 输出兜底；未匹配清单内名字的原样保留） */
export function stripEmojiCodes(app: EmojiCodeApp, text: string): string {
  return text.replace(EMOJI_CODE_RE, (raw, name: string) => (CODE_MAPS[app].has(name) ? '' : raw));
}

/** 内置表情 URL 直查（渲染历史数据等场景） */
export function emojiCodeUrl(app: EmojiCodeApp, name: string): string | null {
  return builtinStickersOf(app).find((s) => s.meaning === name)?.url ?? null;
}

/**
 * 内置表情代码提示词规则（微信 / QQ 共用；表情包开关开启时随人设注入）：
 * 教 AI 认识对方消息里的 [微笑] 代码、并允许它用同样格式发表情（与 [表情包:ID] 大表情互补）。
 * 名字对照「表情包清单」里内置项的意思（清单由 buildRichRules 注入，内置经典在前）——不在清单里的名字
 * 渲染层不识别，只会原样显示文字，所以规则里强调名字只能从清单选。
 */
export const EMOJI_CODE_RULE =
  '【内置小表情】消息里的方括号表情代码（如 [微笑][呲牙][裂开]）是对方发的内置小表情，括号里的名字就是含义，理解并自然回应即可；' +
  '你自己想发这类小表情时，直接在句子里写 [内置表情的意思]（意思必须来自下面表情包清单里的内置表情，写意思不写 ID，' +
  '如清单里有「xx-微笑:微笑」就输出 [微笑]），可与文字混排（如「哈哈[捂脸]」「晚安[月亮]」）；' +
  '写错名字对方只会看到文字；要不要发表情完全自然决定，不要每句都带。';
