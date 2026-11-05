/**
 * 深度思考标签解析/剥离（纯函数模块，客户端与服务端共用）：
 *
 * 从 @/lib/deep-think 抽出的无副作用核心——deep-think.ts 带 'use client' 与 IndexedDB
 * kv 依赖（服务端 route 无法导入），而 [思考]…[/思考] 的兜底剥离需要覆盖服务端链路
 * （朋友圈/QQ空间生成、接听决策等 API 路由），故把状态机与整段解析拆到本模块：
 *
 * - createThinkFilter：流式增量剥离状态机（chat-stream-store 的 onDelta 使用）；
 * - extractThinkBlocks：一次性解析整段文本（非流式兜底——模型跨链路模仿输出思考块时，
 *   主动消息 / 拾光小屋 / 朋友圈 / 电话续聊等入口统一过一遍，防止泄漏进气泡/动态）；
 * - 标签跨增量分片安全：开始/结束标记被网络分片拆开时状态机保留半截前缀不输出。
 *
 * 本模块不得引入任何浏览器/Node 专属 API（保持同构可导入）。
 */

/** 开始标记（用户指定格式，全端统一） */
const OPEN = '[思考]';
/** 结束标记 */
const CLOSE = '[/思考]';

/** 单次 push 的产出：本次新确定的正文 / 思考增量 */
export interface ThinkDelta {
  text: string;
  thinking: string;
}

export interface ThinkFilter {
  /** 喂入流式增量：返回本次可以安全放出的正文与归入思考的内容（标签本身两边都不属于） */
  push: (delta: string) => ThinkDelta;
  /** 流结束：归位残量（未闭合的思考整段归入思考；正文侧可能的半截开始标记按原文放出） */
  finish: () => ThinkDelta;
}

/** s 的尾部是否可能是一个标记的开头前缀（跨增量的半截标记）：返回保留长度（0 = 无需保留） */
function tailPartialTagLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(s.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/**
 * 流式思考剥离状态机（chat-stream-store 的 onDelta 统一使用）：
 *
 * - 正文态（out）：透传一切文本；遇到 [思考] 转思考态，标签丢弃；
 * - 思考态（in）：累积内容归入 thinking；遇到 [/思考] 转回正文态，标签丢弃；
 * - 半截标签保护：增量末尾停在标记前缀中间（「[思」「[/思」）时先扣住不输出，
 *   下个增量拼齐再判定（拼不齐 = 普通文本，finish 时按原文归还正文）；
 * - 输出给调用方的 text 永远不含 [思考]/[/思考] 标签与思考内容，可安全进
 *   正文累计（raw）与分段器（createReplySegmentScanner）。
 */
export function createThinkFilter(): ThinkFilter {
  let buf = '';
  let inside = false;

  const drain = (outText: string[], outThink: string[]): void => {
    for (;;) {
      if (!inside) {
        const idx = buf.indexOf(OPEN);
        if (idx >= 0) {
          if (idx > 0) outText.push(buf.slice(0, idx));
          buf = buf.slice(idx + OPEN.length);
          inside = true;
          continue;
        }
        // 无完整开始标记：尾部可能是半截标记，扣住等下个增量
        const hold = tailPartialTagLen(buf, OPEN);
        const emitLen = buf.length - hold;
        if (emitLen > 0) outText.push(buf.slice(0, emitLen));
        buf = buf.slice(emitLen);
        return;
      }
      const idx = buf.indexOf(CLOSE);
      if (idx >= 0) {
        if (idx > 0) outThink.push(buf.slice(0, idx));
        buf = buf.slice(idx + CLOSE.length);
        inside = false;
        continue;
      }
      // 思考态：同样扣住尾部可能的半截结束标记，其余归入思考
      const hold = tailPartialTagLen(buf, CLOSE);
      const emitLen = buf.length - hold;
      if (emitLen > 0) outThink.push(buf.slice(0, emitLen));
      buf = buf.slice(emitLen);
      return;
    }
  };

  return {
    push(delta) {
      if (!delta) return { text: '', thinking: '' };
      buf += delta;
      const textParts: string[] = [];
      const thinkParts: string[] = [];
      drain(textParts, thinkParts);
      return { text: textParts.join(''), thinking: thinkParts.join('') };
    },
    finish() {
      const textParts: string[] = [];
      const thinkParts: string[] = [];
      if (inside) {
        // 停在思考里（模型没写 [/思考] 就被截断）：全部归入思考，不进正文
        if (buf) thinkParts.push(buf);
      } else {
        // 正文残量（含拼不齐的半截标记原文）按原文放出
        if (buf) textParts.push(buf);
      }
      buf = '';
      inside = false;
      return { text: textParts.join(''), thinking: thinkParts.join('') };
    },
  };
}

/**
 * 一次性解析整段文本（非流式兜底）：提取全部 [思考]…[/思考] 块并从正文剔除。
 * 未闭合的思考块整段归入 thinking；正文里不再残留任何思考痕迹与标签。
 *
 * 深度思考指令只注入单聊 system，但模型会「学会」这种输出习惯——主动消息、拾光小屋、
 * 朋友圈/QQ空间、电话续聊/留言等链路未注入指令也可能被会话历史带偏偶发输出 [思考]，
 * 这些入口在拿到模型原文后统一过一遍本函数，思考内容就地丢弃防泄漏进气泡/动态。
 */
export function extractThinkBlocks(text: string): ThinkDelta {
  if (!text || (!text.includes(OPEN) && !text.includes(CLOSE))) return { text, thinking: '' };
  const f = createThinkFilter();
  const r1 = f.push(text);
  const r2 = f.finish();
  return {
    text: (r1.text + r2.text).replace(/^\n+/, ''),
    thinking: (r1.thinking + r2.thinking).trim(),
  };
}
