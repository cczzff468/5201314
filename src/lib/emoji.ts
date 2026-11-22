/**
 * emoji / 表情符号剥离（纯函数，客户端组件与服务端 route 共用）：
 *
 * - 「表情包开关」关闭（见 @/lib/sticker-toggle）或发动态禁 emoji（/api/moments/generate）时，
 *   除了在提示词里显式禁止，还在内容落盘/返回前做一次硬性剥离——模型偶尔无视禁令，
 *   双保险保证「关闭了就一定没有」；
 * - 覆盖：全部 emoji 主区（U+1F000–1FAFF，含表情/物品/旗帜/肤色修饰符/扩展区）、杂项符号与装饰
 *   （U+2600–27BF：☀☁♻✂✨❤ 等）、表情化技术符号（⌚⌛⏰ 等）、箭头装饰区（⭐⭕⬆ 等）、
 *   变体选择符 U+FE0F、零宽连接符 U+200D、按键帽 U+20E3、波浪线/双叹号等 CJK 符号（〰〽㊗㊙）；
 * - 不碰：普通标点、CJK 文字、颜文字（(￣▽￣)／ 由 ASCII/全角符号构成，属于文字艺术不算 emoji）、
 *   ©®™（纯文本样式的商业符号）。
 */

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u231A\u231B\u23E9-\u23FA\u2B00-\u2BFF\uFE0F\u200D\u20E3\u3030\u303D\u3297\u3299]/gu;

/**
 * 剥掉文本里的所有 emoji 字符，并清理剥离后残留的多余空格 /
 * 标点前的空悬空格（如「你好 😀，我是」→「你好，我是」）。
 */
export function stripEmojiText(text: string): string {
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？、；：,.!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** 测试/调试用：文本里是否含有 emoji 字符 */
export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}
