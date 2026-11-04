/**
 * 「[语音] / [图片]」占位防编造规则（微信 / QQ 单聊、微信群 / QQ 群、信息 App 五端共用）：
 *
 * 背景（AI 感知审计结论）：聊天历史里 AI 只能看到占位文本的两种消息——
 * - 语音：没有转写成功的语音消息映射为「[语音]」，AI 听不到内容；
 * - 图片：没有识图描述的图片消息映射为「[图片]」，AI 看不到内容。
 * 占位本身没有任何提示语义，AI 会装作听过/看过并编造细节（"你声音真好听""照片里的猫真可爱"）。
 *
 * 本模块按「最近消息里是否真的存在内容缺失的占位」决定注入——有才占 token，没有不发：
 * - buildVoicePlaceholderRule：命中「转写失败 / 旧数据未转写」的语音（stt pending 的不算，
 *   转写还在路上，马上会有结果）；
 * - buildImagePlaceholderRule：命中「没有识图描述」的图片，excludeIds 排除本轮正在识图的
 *   消息（描述稍后以独立消息追加，避免"你看不到图片"与"图片内容是…"自相矛盾）。
 */

/** 参与扫描的消息最小形状（各端消息类型的公共子集） */
export interface MediaRuleMsg {
  id?: string;
  kind?: string;
  /** fix3-7 消息方向（可选契约）：'me' = 机主发的 / 'peer' = AI 角色发的；
   *  语音占位规则按此分支归属文案，未传保持原文案（行为不变） */
  role?: 'me' | 'peer';
  /** 图片消息（kind='image'）：desc = 识图描述（无 = AI 看不到内容） */
  img?: { desc?: string } | null;
  /** 语音消息（kind='voice'） */
  voice?: { transcript?: string; localText?: string; stt?: 'pending' | 'done' | 'failed' } | null;
}

/** 是否为「永远拿不到转写」的语音消息：明确失败，或旧数据根本没做过转写（pending = 转写进行中，不算） */
function voiceUnreadable(v: NonNullable<MediaRuleMsg['voice']>): boolean {
  if (v.stt === 'failed') return true;
  if (v.stt === 'pending' || v.stt === 'done') return false;
  return !v.transcript && !v.localText; // 无 stt 标记的旧数据：没转写过
}

/** 「[语音]」占位防编造规则：最近消息里存在听不到内容的语音时注入；无缺失返回空串不占 token。
 *  fix3-7 按发送方分支：机主发的（你听不到对方的内容）与 AI 自己发过的（按当时的本意处理）
 *  是两件完全不同的事，同一句「对方没有转成文字」会让 AI 把自己发的语音当成对方发来的；
 *  未传 role 的调用保持原文案（向后兼容） */
export function buildVoicePlaceholderRule(msgs: MediaRuleMsg[], lookback = 12): string {
  for (let i = msgs.length - 1, seen = 0; i >= 0 && seen < lookback; i--, seen++) {
    const m = msgs[i];
    if (m?.kind !== 'voice' || !m.voice) continue;
    if (!voiceUnreadable(m.voice)) continue;
    if (m.role === 'me') {
      return (
        '【语音占位】聊天记录里的「[语音]」是机主发来的语音消息，没有转成文字，你听不到内容，也不要假装听到了。' +
        '不要编造里面说了什么，也不要说"你声音真好听"这类只有听过才能说的话；' +
        '可以自然请对方用文字说一遍，或只回应你确定的部分。'
      );
    }
    if (m.role === 'peer') {
      return (
        '【语音占位】这条「[语音]」是你自己发过的语音条（当时没有转写存档），按你发它时的本意处理，不要当成对方发来的；' +
        '不要假装记得它"说了什么"，更不要编造细节，只回应你确定的部分。'
      );
    }
    return (
      '【语音占位】聊天记录里的「[语音]」是你听不到内容的语音消息：对方没有把它转成文字，你也无法收听。' +
      '不要假装听过，更不要编造里面说了什么，也不要说"你声音真好听"这类只有听过才能说的话；' +
      '可以自然请对方用文字说一遍，或只回应你确定的部分。'
    );
  }
  return '';
}

/**
 * 「[图片]」占位防编造规则：最近消息里存在没有识图描述的图片时注入（excludeIds 排除本轮正在
 * 识图的消息——描述随后追加为独立上下文，规则不能说反话）；无缺失返回空串不占 token。
 */
export function buildImagePlaceholderRule(
  msgs: MediaRuleMsg[],
  opts?: { excludeIds?: ReadonlySet<string>; lookback?: number },
): string {
  const exclude = opts?.excludeIds;
  for (let i = msgs.length - 1, seen = 0; i >= 0 && seen < (opts?.lookback ?? 12); i--, seen++) {
    const m = msgs[i];
    if (m?.kind !== 'image') continue;
    if (exclude?.has(m.id ?? '')) continue;
    if (m.img?.desc) continue; // 有识图描述：AI 看得到内容
    return (
      '【图片占位】聊天记录里的「[图片]」是你看不到内容的图片消息：不要编造图片里有什么人/物/文字，' +
      '也不要对图片细节发表具体评价（说"照片里的猫真可爱"就是编造）；' +
      '没看到图片描述时，可以泛泛回应，或自然请对方说说图片是什么。'
    );
  }
  return '';
}
