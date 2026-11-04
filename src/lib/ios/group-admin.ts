/**
 * AI 群管理权限（AI 角色被设为群主/管理员时的自动管理能力）。
 *
 * 设计要点：
 * - AI 通过回复里的管理标记行使权限（[禁言:成员:时长] / [解禁:成员] / [移出群聊:成员] /
 *   [改群名:新名] / [改公告:内容]，标记约定见 chat-rich.ts），系统执行后以群事件系统消息公示，
 *   标记本身不落痕；
 * - 权限模型与真微信群一致：群主 > 管理员 > 普通成员。群主可以管理除自己外的所有成员；
 *   管理员只能管理普通成员（群主、其他管理员、自己都动不了）；普通成员没有任何管理权限；
 *   改群名/改公告群主与管理员都可以（日常职责）；
 * - 所有操作最终走 groups.ts 数据层（muteGroupMember/kickGroupMember/updateGroup…），
 *   自动落「XX被禁言1 小时」等系统消息并随群持久化——重启 App 后权限结果（管理员名单、
 *   禁言表、群名、公告）原样保留；
 * - 分寸感（严肃角色管得严、随和角色几乎不用）不由代码硬编码，而是注入提示词让模型按人设自判；
 *   执行器仍保留硬性权限校验兜底，越权标记一律丢弃。
 */

import { groupMuteLeftText, groupRoleOf, isGroupMuted, type ChatGroup } from './groups';

/** 身份中文标签（提示词/事件文案用） */
export function groupRoleLabel(role: 'owner' | 'admin' | 'member'): string {
  return role === 'owner' ? '群主' : role === 'admin' ? '管理员' : '普通成员';
}

/**
 * actor 能否对 target 执行禁言/解禁/移出类操作：
 * - 群主：除自己以外的任何成员（含管理员）；
 * - 管理员：仅普通成员（群主、其他管理员、自己都不行）；
 * - 普通成员：不行。
 * （数据层另有兜底：群主本身永远不可被禁言/移出。）
 */
export function canModerateTarget(g: ChatGroup, actorId: string, targetId: string): boolean {
  if (!targetId || actorId === targetId) return false;
  const actorRole = groupRoleOf(g, actorId);
  if (actorRole === 'owner') return targetId !== g.ownerId;
  if (actorRole === 'admin') return groupRoleOf(g, targetId) === 'member';
  return false;
}

/** actor 能否改群名/改公告：群主与管理员都可以 */
export function canEditGroupInfo(g: ChatGroup, actorId: string): boolean {
  const role = groupRoleOf(g, actorId);
  return role === 'owner' || role === 'admin';
}

/**
 * 解析 AI 写的禁言时长文本 → 毫秒（null = 永久）。
 * 支持：永久 / X 分钟 / X 小时 / X 天 / X 小时Y分钟 组合；纯数字按分钟理解；
 * 完全解析不了时兑底 10 分钟（宁可短禁也别让标记白白丢弃）。
 */
export function parseMuteDuration(text: string): number | null {
  const t = (text ?? '').trim();
  if (!t) return 10 * 60_000;
  if (/永久|一直|不限|长期/.test(t)) return null;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  let ms = 0;
  const days = t.match(/(\d+(?:\.\d+)?)\s*天/);
  if (days) ms += parseFloat(days[1]) * DAY;
  const hours = t.match(/(\d+(?:\.\d+)?)\s*(?:个?小时|时|h|H)/);
  if (hours) ms += parseFloat(hours[1]) * HOUR;
  const mins = t.match(/(\d+(?:\.\d+)?)\s*(?:分种?钟?|分|min|m\b)/);
  if (mins) ms += parseFloat(mins[1]) * MIN;
  if (ms > 0) return Math.min(ms, 30 * DAY);
  const num = t.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (num) return Math.min(parseFloat(num[1]) * MIN, 30 * DAY);
  return 10 * MIN;
}

/**
 * 群管理权限提示词（追加到该角色在群聊里的 extraRules）。
 * - 群主/管理员：标记语法 + 权限边界 + 执行纪律（只有标记才真实生效，口头声称无效）；
 * - 普通成员：不再静默不注入（旧版空白导致成员 AI 被用户要求禁言/给管理员时凭空声称「我点了」）——
 *   显式告知没有权限，被要求执行管理操作时必须如实说明并拒绝假装成功（操作失败要给明确提示）。
 * nameOf：联系人 ID → 称呼名（含机主）。
 */
export function buildGroupAdminRules(g: ChatGroup, charId: string, nameOf: (id: string) => string): string[] {
  const role = groupRoleOf(g, charId);
  if (role === 'member') {
    // 普通成员：如实告知没有权限 + 群里谁有权限（被用户要求禁言/给管理员时拒绝假装成功）
    const ownerName = g.ownerId ? nameOf(g.ownerId) : '';
    const adminNames = g.adminIds.filter((id) => id !== g.ownerId).map(nameOf);
    const whoCan = [
      ownerName ? `群主是「${ownerName}」` : '',
      adminNames.length > 0 ? `管理员：${adminNames.map((n) => `「${n}」`).join('、')}` : '',
    ]
      .filter(Boolean)
      .join('，');
    return [
      '【群管理权限】你不是这个群的群主或管理员，只是普通成员——禁言、解禁、踢人、改群名、改公告、任命管理员这些事你都做不了（系统也不会执行）。' +
        '别人让你做这些操作时，必须如实说明你只是普通成员、做不了' + (whoCan ? `，建议 TA 直接找${whoCan}` : '') + '；' +
        '绝不能假装已经执行、更不能说「我点了」「我做了」这类话。',
    ];
  }
  const rules: string[] = [];
  const boundary =
    role === 'owner'
      ? '你只能管理除你自己以外的成员（群主身份不能对自己动手）'
      : '你只能管理普通成员：群主、其他管理员和你自己都动不了（越权操作会被系统直接拒绝）';
  rules.push(
    '【你的群管理权限】你是这个群的' + groupRoleLabel(role) + '。需要维持群秩序时，你可以在回复里输出对应管理标记（标记单独占一行，前后不要加引号或代码块）：' +
      '[禁言:成员名字:时长] 禁言某人（时长写 10分钟/1小时/3小时/1天/永久，如 [禁言:红红:1小时]）；' +
      '[解禁:成员名字] 解除禁言；' +
      '[移出群聊:成员名字] 将某人移出群聊（最后手段，极慎用）；' +
      '[改群名:新群名] 修改群名；' +
      '[改公告:公告内容] 更新群公告。' +
      '标记会被系统执行并以群通知公示，标记本身不会显示出来；操作后用你自己的语气简短说一句原因即可。' +
      `权限边界：${boundary}。` +
      '标记里的成员名字必须写【群聊模式】参与成员名单里的名字（TA 的名字或昵称都行），写错名字操作不会生效。',
    // 执行纪律（防「我明明点了」假成功）：只有标记执行了才算数，系统通知是唯一凭据
    '【管理操作·执行铁律】管理操作只有真的输出了对应标记才会生效，只打字说「我禁言了」「我给你管理员了」不会有任何实际效果；' +
      '操作是否成功以群里出现的系统通知为准（如「XX被禁言10 分钟」）——没看到对应通知就等于没执行成功，要如实告知对方，绝不能在没输出标记的情况下声称已经操作过。',
    '【管理分寸】是否动用权限、何时动用，完全由你的性格决定：严厉较真、看重秩序的角色可以在有人刷屏、吵架抬杠、发广告、严重违规时果断出手（以禁言为主，踢人是最后手段）；温和随性、不爱管事的角色几乎不动用权限，最多口头劝一句。绝不无故禁言或踢人，不拿权限挟私报复，也别管得太宽让人窒息；改群名/改公告属于日常事务，有正当理由时可以自然使用。',
  );
  // 当前禁言名单（AI 感知：谁被禁着、还剩多久，解禁标记才有意义）
  const mutedLines = Object.keys(g.mutes)
    .filter((id) => isGroupMuted(g, id))
    .map((id) => {
      const left = groupMuteLeftText(g, id);
      return `${nameOf(id)}（${left ?? '永久'}）`;
    });
  if (mutedLines.length > 0) {
    rules.push(`【当前禁言中】${mutedLines.join('；')}。对应成员可以用 [解禁:名字] 提前解除。`);
  }
  return rules;
}
