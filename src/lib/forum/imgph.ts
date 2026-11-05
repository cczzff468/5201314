/**
 * X论坛 · [图片] 占位符共享模块（v28 从 core.ts 拆出）。
 *
 * 无 'use client' 指令——服务端（api/forum/generate 路由）与客户端
 * （engine/组件）双端共用。v27 曾把这两个导出留在 core.ts（'use client'），
 * 服务端路由 import 后调用 stripImgPh() 会抛
 * 「Attempted to call stripImgPh() from the server」客户端边界错误——
 * 评论三分支（comments/subreplies/multiComments）在 LLM 调用前的
 * 预处理就整段崩掉，被 engine 的 try/catch 静默吃掉，评论区表现为
 * 「还没有回复」（叠加在上游 429 噪音里极难察觉）。拆出后：
 * - route.ts（服务端）与 core.ts（客户端再导出，兼容既有 import）各取所需；
 * - 字符串常量 IMG_PLACEHOLDER 此前靠常量折叠「侥幸」能用，函数调用必崩。
 */

/** v27 图文并茂帖：正文中 AI 配图占位符（LLM 按 has_image 在最自然位置插入，
 *  渲染端按它分段交替上屏「文字段-文字图-文字段」）。 */
export const IMG_PLACEHOLDER = '[图片]';

/** 剥掉正文里的 [图片] 占位符（评论生成上下文/锚定校验/翻译前使用——
 *  占位符字样混进锚定词表会把正常评论误杀成「与帖子无关」）。 */
export function stripImgPh(text: string): string {
  return text
    .split(IMG_PLACEHOLDER)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
