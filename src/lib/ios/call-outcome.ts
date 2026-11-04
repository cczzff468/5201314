/**
 * 通话结局状态（电话 / 微信 / QQ 三端通话共用一套语义）——
 *
 * 「对方拒接」「对方没接」「接通后挂断」是三件不同的事，全链路（通话卡片、挂断续聊 followup、
 * 聊天上下文标记）都从这里取状态，保证 UI 与 AI 的理解一致、绝不混淆：
 *
 *   - rejected  已拒绝：响铃时对方按了「拒绝」——电话从未接通，一句话都没说上
 *   - missed    未接听：响了很久一直没人接（或超时不了了之）——电话从未接通，一句话都没说上
 *   - cancelled 已取消：对方拨给你但接通前主动取消——电话从未接通
 *   - ended     已挂断：电话真实接通过，双方聊过，之后才结束（对方先挂 / 你主动挂）
 */

export type CallOutcome = 'rejected' | 'missed' | 'cancelled' | 'ended';

/**
 * endReason（引擎上报）+ connected → 结局的唯一映射。
 * 未知原因宁可按「未接听」处理，也绝不编造一段「接通后被挂断」的通话；
 * 数据矛盾（如 hangup 但 connected=false）同样以未接通为准。
 */
export function callOutcomeOf(endReason: string, connected: boolean): CallOutcome {
  switch (endReason) {
    case 'reject':
      return 'rejected';
    case 'missed-in':
    case 'no-answer':
      return 'missed';
    case 'cancel':
      return 'cancelled';
    default:
      return connected ? 'ended' : 'missed';
  }
}

/** 该结局是否真的接通过（存在真实通话内容） */
export function outcomeConnected(o: CallOutcome): boolean {
  return o === 'ended';
}
