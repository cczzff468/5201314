/**
 * 提示词查看器（v72 全局悬浮工具）：下一轮将发送给大模型的完整 Prompt 无副作用预览。
 *
 * 设计口径：
 * - 与真实发送链路（wechat.tsx / qq.tsx / chat.tsx 的 runAiTurn）同一套库函数、同一拼装顺序——
 *   人设（buildPersonaSystemPrompt + wx/qq/sms-rules 组）、记忆召回（memChatRecallBlock）、
 *   世界书（collectWbBlocks + applyWbUserBlocks）、动态状态/朋友圈/论坛/情侣/美团/淘宝/音乐/
 *   位置/拉黑/头像/时间感知/跨 App 上下文/角色分支等全部动态块、聊天历史（最近 20 条同款序列化）；
 * - 纯本地拼装：不请求网络、不消耗 Token、不写任何存储、不打断进行中的对话；
 * - 预览没有「本轮新消息」：记忆/世界书的扫描文本用最近历史代替（userMsg/sysEvent 为空）；
 *   待处理红包/转账动作规则（依赖本轮卡片状态）在预览中省略。
 */

import { listContacts, cachedOwnerName } from '@/lib/ios/contacts-store';
import { activeAccountIdOf, addressNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { getAccountById } from '@/lib/ios/accounts';
import { useSettings } from '@/lib/ios/store';
import { loadStickers } from '@/lib/ios/stickers';
import { getStickersOn } from '@/lib/sticker-toggle';
import { getActionDescOn } from '@/lib/action-desc';
import { getAiVoiceFreq } from '@/lib/ios/ai-voice';
import { getReplyCount, buildReplyCountPrompt } from '@/lib/reply-count';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { DEEP_THINK_RULE } from '@/lib/deep-think';
import { promptGroupParts, promptTextOf, promptRule } from '@/lib/prompt-entries';
import { buildRichRules, buildVisionRules, buildMomentPostRule } from '@/lib/chat-rich';
import { buildPhotoTagRule } from '@/lib/imggen';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { getMemSettings, memChatRecallBlock, profileRecallBlock, setMemScopeForApp } from '@/lib/memory';
import { isPostMemoryOn } from '@/lib/forum/core';
import { buildForumChatBlock } from '@/lib/forum/social';
import { buildMomentsChatBlock } from '@/lib/moments';
import { coupleChatBlock } from '@/lib/ios/couple-ai';
import { applyWbUserBlocks, collectWbBlocks, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { buildBranchPromptBlock } from '@/lib/ios/branch';
import { buildDynamicStateBlocks } from '@/lib/ios/ai-mood';
import { buildAvatarBlock } from '@/lib/ios/avatar-ai';
import { buildLocationBlock, locationAiText } from '@/lib/ios/chat-location';
import { buildBlockPromptBlock } from '@/lib/ios/block-state';
import { buildVoicePlaceholderRule, buildImagePlaceholderRule } from '@/lib/chat-media-rules';
import { buildKickNoticeSection, buildGroupSocialRules } from '@/lib/ios/group-social';
import { activeQuitFlowFor } from '@/lib/ios/quit-flow';
import { buildMtEngageCtx } from '@/lib/ios/mt-ai-engage';
import { buildTbEngageCtx } from '@/lib/ios/tb-ai-engage';
import { togetherLiveBlock } from '@/lib/ios/music-remote';
import { listAlbumsForChat } from '@/lib/ios/album-store';
import { effectiveInterop } from '@/lib/ios/groups';
import { kvGet } from '@/lib/ios/idb-kv';
import { getProactiveCfg, getActiveProactiveChats } from '@/lib/ios/proactive-msg';
import { loadMeet } from '@/lib/offline-meet';

// ---------------- 类型 ----------------

export type PreviewChannel = 'wx' | 'qq' | 'sms';

export interface PreviewMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PreviewSectionStat {
  key: string;
  label: string;
  chars: number;
}

export interface PreviewResult {
  channel: PreviewChannel;
  channelLabel: string;
  contactId: string;
  contactName: string;
  sessionKey: string;
  /** 追发（焦虑追发）开关状态 */
  anxietyOn: boolean;
  /** 线下模式（约会）进行中 */
  offlineOn: boolean;
  replyCount: number;
  stickersOn: boolean;
  actionDescOn: boolean;
  /** 完整 System Prompt（人设 + 全部动态块 + 条数 + 深度思考，与真实发送同序） */
  systemFull: string;
  /** 发送给模型的完整消息数组（首条 system + 最近 20 条历史，世界书 user 块已包裹） */
  messages: PreviewMessage[];
  /** 各块字符统计（调试用：记忆/世界书有没有注入成功一目了然） */
  sections: PreviewSectionStat[];
}

/** 语音/视频通话能力常量（与 wechat/qq.tsx 逐字一致；不接预设注册表，恒注入） */
const VOICE_CALL_RULE =
  '【语音通话能力】如果你此刻非常想和对方马上说话（想TA了、有急事、聊到特别开心等自然原因），可以在回复的最开头单独加上标记 [语音通话] 发起一次语音通话邀请，对方手机会弹出你的来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。';
const VIDEO_CALL_RULE =
  '【视频通话能力】如果你此刻很想看看对方（想TA了、有值得分享的时刻、对方说想见你/想看看你等自然原因），可以在回复的最开头单独加上标记 [视频通话] 发起一次视频通话邀请，对方手机会弹出你的视频来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。注意：标记必须是单独四个字 [视频通话]，严禁模仿聊天记录里「[视频通话：时长/内容摘要]」这类卡片描述文字的格式（那是系统卡片不是标记），不要输出带冒号的 [视频通话：……]。';

export const CHANNEL_LABELS: Record<PreviewChannel, string> = { wx: '微信', qq: 'QQ', sms: '信息' };

// ---------------- 消息记录的宽松读取（kv 里存的 WxMsg/QQ 消息/Sms ChatMsg 三种形状共用） ----------------

type RawMsg = Record<string, unknown>;

function asObj(v: unknown): RawMsg | null {
  return v && typeof v === 'object' ? (v as RawMsg) : null;
}
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNum(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
function asBool(v: unknown): boolean {
  return v === true;
}

/** 红包/转账/亲属卡/礼物卡状态标签（复制自 wechat.tsx wxCardStateLabel 的核心分支，供历史序列化用） */
function cardStateLabelOf(m: RawMsg): string {
  const role = asStr(m.role);
  const rp = asObj(m.rp);
  if (rp) {
    if (asStr(rp.status) === 'returned') return '已退回';
    if (asStr(rp.status) === 'rejected') return '已拒收';
    if (asBool(rp.opened)) return asStr(rp.openedBy) ? `已领取（${asStr(rp.openedBy)}领取）` : '已领取';
    return '待领取';
  }
  const tr = asObj(m.tr) ?? asObj(m.packet);
  if (tr) {
    if (asStr(tr.status) === 'returned') return '已退回';
    if (asStr(tr.status) === 'rejected') return '已拒收';
    if (asBool(tr.received)) return '已收款';
    return '待收款';
  }
  const fam = asObj(m.fam);
  if (fam) {
    if (asBool(fam.rejected)) return '已退回';
    if (asBool(fam.claimed)) return '已领取';
    return '待领取';
  }
  const gift = asObj(m.gift);
  if (gift) return asBool(gift.accepted) ? '已收下' : '待收下';
  return '';
}

/** 微信/QQ 历史消息序列化（对应 wechat.tsx L7071 / qq.tsx L5249 的历史构建，取主干分支） */
function serializeChatHistory(
  base: RawMsg[],
  opts: { meDisplay: string; meReal: string; peerName: string; meAddrName: string },
): PreviewMessage[] {
  const kept = base
    .filter((m) => {
      if (asBool(m.recalled)) return false;
      const content = asStr(m.content);
      const kind = asStr(m.kind);
      const hasPayload =
        !!content ||
        ['sticker', 'image', 'textcard', 'voice', 'call', 'redpacket', 'transfer', 'family', 'groupcard', 'relcard', 'pactcard', 'examcard', 'lettercard', 'giftcard', 'location', 'song'].includes(kind) ||
        (kind === 'sys' && asObj(m.sys) && asObj(m.sys)!.pat != null);
      if (!hasPayload) return false;
      if (content.startsWith('〔') || content.startsWith('（AI')) return false;
      return true;
    })
    .slice(-20);

  // 行首 [M数字] 编号（AI 的 [引用:编号] 机制）
  const quoteIdOf = new Map<string, string>();
  {
    let n = 0;
    for (const m of kept) {
      if (asBool(m.error)) continue;
      n += 1;
      quoteIdOf.set(asStr(m.id), `M${n}`);
    }
  }
  // 我发的图片会话内编号（第N张）
  const userImgSeq = new Map<string, number>();
  {
    let n = 0;
    for (const m of kept) {
      if (m.role === 'me' && asStr(m.kind) === 'image') {
        n += 1;
        userImgSeq.set(asStr(m.id), n);
      }
    }
  }

  return kept.map((m) => {
    const role = m.role === 'me' ? ('user' as const) : ('assistant' as const);
    const meReal = opts.meReal;
    const quote = asObj(m.quote);
    const fwd = asObj(m.fwd);
    const fr = asStr(m.fr);
    const pre = `${
      fr === 'apply' ? '[好友验证消息，不是聊天内容] ' : fr === 'greet' ? '[打招呼，不是聊天内容] ' : ''
    }${quote ? `（引用 ${asStr(quote.name) === opts.meDisplay ? meReal : asStr(quote.name)}：「${asStr(quote.content)}」）` : ''}${
      asStr(m.kind) === 'forward' && fwd
        ? asBool(fwd.merged)
          ? `[合并转发的聊天记录「${asStr(fwd.title) || '聊天记录'}」] `
          : `[转发自「${asStr(fwd.from)}」的消息] `
        : ''
    }`;
    const thinking = m.role === 'peer' ? asStr(m.thinking) : '';
    const id = asStr(m.id);
    const kind = asStr(m.kind);
    const img = asObj(m.img);
    const voice = asObj(m.voice);
    const stk = asObj(m.stk);
    const song = asObj(m.song);
    const card = asObj(m.card);
    const loc = asObj(m.loc);
    const rp = asObj(m.rp);
    const tr = asObj(m.tr) ?? asObj(m.packet);
    const fam = asObj(m.fam);
    const fwdRecords = Array.isArray(fwd?.records) ? (fwd!.records as RawMsg[]) : [];
    let body: string;
    if (kind === 'forward' && fwd && asBool(fwd.merged)) {
      body = `[聊天记录：${fwdRecords.slice(-8).map((r) => `${asStr(r.name)}：${asStr(r.text)}`).join(' ／ ')}]`;
    } else if (kind === 'image') {
      const desc = img ? asStr(img.desc) : '';
      body =
        m.role === 'me' && userImgSeq.has(id)
          ? `[图片 ID:${id}]（我发的第${userImgSeq.get(id)}张图${desc ? `；图片内容：${desc}）` : '；未识图，暂无内容描述）'}`
          : desc
            ? `[图片 ID:${id}]（图片内容：${desc}）`
            : `[图片 ID:${id}]（未识图，暂无内容描述）`;
    } else if (kind === 'song' && song) {
      body =
        m.role === 'me'
          ? `[歌曲卡片]《${asStr(song.name)}》${asStr(song.artist)}`
          : asBool(song.autoPlay)
            ? `[放歌:${asStr(song.name)}:${asStr(song.artist)}]`
            : `[分享歌曲:${asStr(song.name)}:${asStr(song.artist)}]`;
    } else if (kind === 'textcard' && card) {
      body = `[文字图片]（卡片上写着：${asStr(card.text)}）`;
    } else if (kind === 'voice') {
      body = asBool(m.error) ? '[语音]' : (voice && asStr(voice.transcript)) || (voice && asStr(voice.localText)) || '[语音]';
    } else if (kind === 'location' && loc) {
      body = locationAiText(loc as Parameters<typeof locationAiText>[0], asNum(m.time));
    } else if (kind === 'sticker' && stk) {
      body =
        m.role === 'me'
          ? `[发送了表情：${asStr(stk.meaning) || '无描述'}]`
          : asStr(stk.sid)
            ? `[表情包:${asStr(stk.sid)}]`
            : `[你发送了表情：${asStr(stk.meaning) || '无描述'}]`;
    } else if (kind === 'redpacket' && rp) {
      body = `[红包 ID:${asStr(rp.cid) || id} ¥${asNum(rp.amount)} "${asStr(rp.blessing)}"（${
        m.role === 'me' ? `${opts.meAddrName}发给${opts.peerName}` : `${opts.peerName}发给${opts.meAddrName}`
      }），${cardStateLabelOf(m)}]`;
    } else if (kind === 'transfer' && tr) {
      body = `[转账 ID:${asStr(tr.cid) || id} ¥${asNum(tr.amount)}${asStr(tr.note) ? ` "${asStr(tr.note)}"` : ''}（${
        m.role === 'me' ? `${opts.meAddrName}转给${opts.peerName}` : `${opts.peerName}转给${opts.meAddrName}`
      }），${cardStateLabelOf(m)}]`;
    } else if (kind === 'family' && fam) {
      body = `[亲属卡 ID:${asStr(fam.cid) || id} 每月额度¥${asNum(fam.monthlyLimit)}（${
        m.role === 'me' ? `${opts.meAddrName}送给${opts.peerName}` : `${opts.peerName}送给${opts.meAddrName}`
      }），${cardStateLabelOf(m)}]`;
    } else if (kind === 'groupcard') {
      const g = asObj(m.gcard);
      body = `[群聊邀请卡片：${g ? asStr(g.name) : ''}（${g ? asStr(g.inviterName) || '群友' : ''}邀请${
        Array.isArray(g?.memberNames) ? `，成员：${(g!.memberNames as string[]).join('、')}` : ''
      }），${g ? (asStr(g.status) === 'pending' ? '待处理' : asStr(g.status) === 'accepted' ? '已接受' : '已拒绝') : ''}]`;
    } else if (kind === 'relcard') {
      const rc = asObj(m.relcard);
      body = `[亲密关系卡片：${
        rc && asStr(rc.stage) === 'invite'
          ? `${asStr(rc.fromName)}邀请${asStr(rc.toName)}建立情侣关系`
          : `${rc ? asStr(rc.fromName) : ''}已同意，双方成功建立情侣关系`
      }，${rc ? (asStr(rc.status) === 'pending' ? '待处理' : asStr(rc.status) === 'accepted' ? '已接受' : '已拒绝') : ''}]`;
    } else if (kind === 'giftcard') {
      const gift = asObj(m.gift);
      body = gift
        ? m.role === 'me'
          ? `[礼物卡片 ID:${asStr(gift.id)}]（${opts.meAddrName}送你「${asStr(gift.name)}」${asStr(gift.countLabel)}，${asBool(gift.accepted) ? '你已收下' : '待你收下'}）`
          : `[礼物卡片 ID:${asStr(gift.id)}]（你送出「${asStr(gift.name)}」${asStr(gift.countLabel)}，${asBool(gift.accepted) ? `${opts.meAddrName}已收下` : `待${opts.meAddrName}收下`}）`
        : '';
    } else {
      body = asStr(m.content);
    }
    const content = `${thinking ? `[思考]${thinking}[/思考]\n` : ''}${quoteIdOf.has(id) ? `[${quoteIdOf.get(id)}] ` : ''}${pre}${body}`;
    return { role, content };
  });
}

/** 信息（短信）历史序列化（对应 chat.tsx L1810-1844） */
function serializeSmsHistory(base: RawMsg[]): PreviewMessage[] {
  return base
    .filter((m) => {
      const content = asStr(m.content);
      const kind = asStr(m.kind);
      return !!(content || kind === 'voice' || (kind === 'image' && asObj(m.img)) || (kind === 'textcard' && asObj(m.card)) || (kind === 'forumshare' && asObj(m.forumshare)));
    })
    .sort((a, b) => asNum(a.time) - asNum(b.time))
    .slice(-20)
    .map((m) => {
      const role = m.role === 'user' || m.role === 'me' ? ('user' as const) : ('assistant' as const);
      const thinking = role === 'assistant' ? asStr(m.thinking) : '';
      const quote = asObj(m.quote);
      const kind = asStr(m.kind);
      const voice = asObj(m.voice);
      const img = asObj(m.img);
      const card = asObj(m.card);
      let body: string;
      if (kind === 'voice') body = (voice && asStr(voice.transcript)) || (voice && asStr(voice.localText)) || '[语音]';
      else if (kind === 'image') body = img && asStr(img.desc) ? `[图片]（图片内容：${asStr(img.desc)}）` : '[图片]';
      else if (kind === 'textcard' && card) body = `[文字图片]（卡片上写着：${asStr(card.text)}）`;
      else body = asStr(m.content);
      return {
        role,
        content: `${thinking ? `[思考]${thinking}[/思考]\n` : ''}${quote ? `（引用 ${asStr(quote.name)}：「${asStr(quote.content)}」）` : ''}${body}`,
      };
    });
}

/** 消息的 AI 可读文本（记忆/世界书扫描口径：语音转写 / 位置全文 / 图片描述 / 文本内容） */
function scanTextOf(m: RawMsg): string {
  const kind = asStr(m.kind);
  if (kind === 'voice') {
    const v = asObj(m.voice);
    return v ? asStr(v.transcript) : '';
  }
  if (kind === 'location') {
    const loc = asObj(m.loc);
    return loc ? locationAiText(loc as Parameters<typeof locationAiText>[0], asNum(m.time)) : '';
  }
  if (kind === 'image') {
    const img = asObj(m.img);
    return img ? asStr(img.desc) : '';
  }
  if (kind === 'textcard') {
    const card = asObj(m.card);
    return card ? asStr(card.text) : '';
  }
  return asStr(m.content);
}

function kvMsgs(key: string): RawMsg[] {
  const raw = kvGet<unknown>(key);
  return Array.isArray(raw) ? (raw as RawMsg[]) : [];
}

// ---------------- 主入口：拼装下一轮完整 Prompt ----------------

export async function buildChatPreview(channel: PreviewChannel, contactId: string): Promise<PreviewResult> {
  const contacts = await listContacts();
  const peer = contacts.find((c) => c.id === contactId && c.kind !== 'user');
  if (!peer) throw new Error('角色不存在或已被删除');

  // 「我」= 当前账号对应的机主卡片（主号取机主，小号/匿名号取账号档案——与各 App 同口径）
  const accId = activeAccountIdOf(channel);
  const acc = getAccountById(accId);
  const meCard =
    acc && acc.kind !== 'main'
      ? contacts.find((c) => c.altOf === accId) ?? contacts.find((c) => c.kind === 'user')
      : contacts.find((c) => c.kind === 'user' && !c.altOf) ?? contacts.find((c) => c.kind === 'user');
  if (!meCard) throw new Error('未找到机主资料');

  const meAddrName = addressNameOf(meCard, useSettings.getState().addressMode);
  const meDisplay = meCard.nickname?.trim() || meCard.name; // 社交展示名（朋友圈检索口径）
  const meReal = meCard.realName?.trim() || meCard.name;
  const sessionKey = channel === 'wx' ? `wx:${contactId}` : channel === 'qq' ? `qq:${contactId}` : `sms:c:${contactId}`;
  const memApp = channel === 'wx' ? 'wx' : channel === 'qq' ? 'qq' : 'sms';

  // B8 作用域竞态修复（与真实发送同款）：人设/记忆组装前先落账号作用域
  setMemScopeForApp(memApp);

  // ---- 会话开关（发送时现场读取，预览同样现场读） ----
  const stickersOn = channel === 'sms' ? false : getStickersOn(sessionKey);
  const actionDescOn = getActionDescOn(sessionKey);
  const aiVoiceOn = channel === 'sms' ? getAiVoiceFreq(sessionKey) !== 'off' || getAiVoiceFreq(`wx:${contactId}`) !== 'off' : getAiVoiceFreq(sessionKey) !== 'off';
  const replyCount = getReplyCount(sessionKey);
  const memSettings = getMemSettings(contactId);

  // ---- 历史记录（kv 同步读） ----
  const base = channel === 'sms' ? kvMsgs(`ios-chat-msgs:c:${contactId}`) : kvMsgs(`${channel}-chat-msgs:${contactId}`);
  const history =
    channel === 'sms'
      ? serializeSmsHistory(base)
      : serializeChatHistory(base, { meDisplay, meReal, peerName: peer.name, meAddrName });

  // ---- 人设（三端各自的组装口径） ----
  const npcExtra = buildNpcPromptExtra(peer, contacts);
  const ownerName = peer.ownerId ? contacts.find((o) => o.id === peer.ownerId)?.name ?? null : null;
  let system: string;
  const sections: PreviewSectionStat[] = [];
  const pushSection = (key: string, label: string, text: string) => {
    if (text) sections.push({ key, label, chars: text.length });
  };

  if (channel === 'wx' || channel === 'qq') {
    const p = channel === 'wx' ? 'wx' : 'qq';
    const stickers = loadStickers(channel);
    const rich = buildRichRules(stickersOn ? stickers : [], channel === 'qq' ? { familyCard: false } : undefined);
    const richBlock = rich.length === 0 ? '' : promptTextOf(`${p}-rich-rules`, {}, rich.join('\n')) ?? '';
    const ruleParts = promptGroupParts(`${p}-rules`, { richRules: richBlock }, () =>
      [
        ...(stickersOn ? [promptRule(`${p}-emoji-code`) ?? ''] : []),
        ...richBlock.split('\n'),
        ...(stickersOn ? [] : [promptRule(`${p}-sticker-off`) ?? '']),
        ...(actionDescOn
          ? [promptRule(`${p}-action-desc`) ?? '']
          : [promptRule(`${p}-action-desc-off`) ?? '']),
        ...(aiVoiceOn ? [promptRule(`${p}-ai-voice`) ?? ''] : []),
      ].filter(Boolean),
    );
    system = buildPersonaSystemPrompt(peer, {
      channel: channel === 'wx' ? '微信' : 'QQ',
      userName: meAddrName,
      ownerName,
      accountId: accId,
      multiApp: memSettings.share,
      ...npcExtra,
      extraRules: ruleParts ?? [],
    });
  } else {
    // 信息（短信）：陌生身份模式判定 + sms-rules 组（ai-voice 一条）
    const smsAcc = getAccountById(accId);
    const stranger =
      !!smsAcc &&
      smsAcc.kind !== 'main' &&
      !(peer.relationByAcc?.[accId] ?? '').trim() &&
      ![peer.friendWxByAcc?.[accId], peer.friendQqByAcc?.[accId], peer.friendSmsByAcc?.[accId]].some((v) => typeof v === 'boolean');
    const smsRuleParts = promptGroupParts('sms-rules', {}, () =>
      (aiVoiceOn ? [promptRule('sms-ai-voice') ?? ''] : []).filter(Boolean),
    );
    system = buildPersonaSystemPrompt(peer, {
      channel: '短信',
      userName: addressNameOf({ name: meReal, realName: meReal }, useSettings.getState().addressMode),
      ownerName,
      accountId: accId,
      multiApp: memSettings.share,
      extraRules: smsRuleParts ?? [],
      ...(stranger ? { strangerMode: 'text' as const } : {}),
      ...npcExtra,
    });
  }
  pushSection('persona', '角色人设', system);

  // ---- 记忆召回（预览无新消息：扫描文本用最近历史） ----
  const recentScan = base.slice(-8).map(scanTextOf).filter((t) => t.length > 0);
  const memoryBlock = memChatRecallBlock(contactId, memApp, recentScan.slice(-7).join(' '), {
    interopOn: channel === 'sms' ? memSettings.share : effectiveInterop,
    disclosureText: base.slice(-8).filter((m) => m.role === 'me' || m.role === 'user').map(scanTextOf).filter(Boolean).join(' '),
    altMainName: cachedOwnerName(),
    altMainRelation: peer.relation?.trim() || '',
    excludeFragmentSources: isPostMemoryOn() ? undefined : ['forum'],
  });
  pushSection('memory', '记忆召回', memoryBlock);

  // ---- 世界书（关键词命中） ----
  const wbBlocks = collectWbBlocks(
    contactId,
    wbScanText(recentScan),
    channel === 'sms' ? undefined : { charName: peer.name, userName: meAddrName },
  );
  const wbChars = [wbBlocks.beforeSystem, wbBlocks.beforeChar, wbBlocks.afterChar, wbBlocks.afterSystem].reduce((s, t) => s + t.length, 0);
  if (wbChars > 0) sections.push({ key: 'worldbook', label: '世界书', chars: wbChars });
  pushSection('wbRules', '世界书使用规则', wbRulesBlock(wbBlocks));

  // ---- 动态块（全部与真实发送同源：kv/内存现场读） ----
  const dynamicState = buildDynamicStateBlocks(contactId);
  pushSection('mood', '动态状态', dynamicState);

  const crossBlocks = await buildCrossContextBlocks(contactId, memApp, channel === 'sms' ? useSettings.getState().profile.name : meReal).catch(() => null);
  pushSection('crossApp', '跨 App 上下文', crossBlocks?.crossAppBlock ?? '');
  pushSection('group', '群聊上下文', crossBlocks?.groupBlock ?? '');

  const scanArr = recentScan;
  const momentsBlock = buildMomentsChatBlock({
    contactId,
    app: memApp,
    userName: meDisplay,
    userRealName: meReal,
    peer,
  });
  pushSection('moments', '朋友圈动态', momentsBlock);

  const forumBlock = buildForumChatBlock(contactId, undefined);
  pushSection('forum', '论坛近况', forumBlock);

  const coupleBlock = channel === 'sms' ? '' : coupleChatBlock(contactId, channel as 'wx' | 'qq', meAddrName);
  pushSection('couple', '情侣空间', coupleBlock);

  const mtEngage = channel === 'sms' ? { block: '', rules: [] as string[] } : buildMtEngageCtx(contactId, channel as 'wx' | 'qq', scanArr);
  const tbEngage = channel === 'sms' ? { block: '', rules: [] as string[] } : buildTbEngageCtx(contactId, channel as 'wx' | 'qq', scanArr);
  pushSection('mt', '美团动态', mtEngage.block);
  pushSection('tb', '淘宝动态', tbEngage.block);

  const musicBlock = channel === 'sms' ? '' : togetherLiveBlock(contactId, meAddrName);
  pushSection('music', '音乐情境', musicBlock);

  const locBlock = channel === 'sms' ? '' : buildLocationBlock(base as Parameters<typeof buildLocationBlock>[0], { userLabel: meAddrName, peerLabel: `「${peer.name}」` });
  pushSection('loc', '位置感知', locBlock);

  const avatarBlock = buildAvatarBlock(contactId, meCard.id, meAddrName);
  pushSection('avatar', '头像感知', avatarBlock);

  const blkBlock = buildBlockPromptBlock(channel, contactId, channel === 'sms' ? useSettings.getState().profile.name : meAddrName);
  pushSection('block', '拉黑状态', blkBlock);

  const quitSection = channel === 'sms' ? '' : activeQuitFlowFor(contactId)?.section ?? '';
  pushSection('quit', '退群挽留', quitSection);

  const kickSection = channel === 'sms' ? '' : buildKickNoticeSection(contactId, meAddrName);
  pushSection('kick', '被踢感知', kickSection);

  const socialRules = channel === 'sms' ? '' : buildGroupSocialRules(peer, channel as 'wx' | 'qq', contacts, meAddrName);
  pushSection('social', '建群能力', socialRules);

  const branchBlock = await buildBranchPromptBlock(contactId).catch(() => '');
  pushSection('branch', '角色分支', branchBlock);

  // 语音/图片占位防编造
  const mediaRules = [
    buildVoicePlaceholderRule(base as Parameters<typeof buildVoicePlaceholderRule>[0]),
    buildImagePlaceholderRule(base as Parameters<typeof buildImagePlaceholderRule>[0], {}),
  ].filter(Boolean);
  pushSection('media', '占位防编造', mediaRules.join('\n\n'));

  // 时间感知
  const timeBlock = getTimeAware(sessionKey)
    ? buildTimeAwareBlock({
        lastMsgTime: base.length > 0 ? asNum(base[base.length - 1].time) : null,
        regionHint: peer.region || null,
      })
    : '';
  pushSection('time', '时间感知', timeBlock);

  // 视觉自主决策规则（相册清单）
  let visionRules: string[] = [];
  if (channel !== 'sms') {
    const albums = await listAlbumsForChat(contactId, meCard.id).catch(() => []);
    const albumSummary = albums.filter((a) => a.contactId === contactId).length > 0
      ? albums.filter((a) => a.contactId === contactId).slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
      : null;
    const ownerAlbumSummary = albums.some((a) => a.contactId === meCard.id)
      ? albums.filter((a) => a.contactId === meCard.id).slice(-15).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
      : null;
    visionRules = buildVisionRules(albumSummary, undefined, ownerAlbumSummary);
  } else {
    const albums = await listAlbumsForChat(contactId, meCard.id).catch(() => []);
    const albumSummary = albums.filter((a) => a.contactId === contactId).length > 0
      ? albums.filter((a) => a.contactId === contactId).slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
      : null;
    visionRules = albumSummary ? [...buildVisionRules(albumSummary), '【信息端限制】当前会话只支持 [选图设头像:相册条目ID]，[选图设背景] 与 [选图发送] 在信息端不可用，请不要使用这两个标记。'] : [];
  }
  pushSection('vision', '视觉决策', visionRules.join('\n\n'));

  // 生图（照片标签）规则
  const photoRule = buildPhotoTagRule(peer.name);
  pushSection('photo', '照片标签', photoRule);

  // AI 发朋友圈/说说能力
  const momentPostRule = channel === 'sms' ? '' : buildMomentPostRule(channel);
  pushSection('momentPost', '发动态能力', momentPostRule);

  // ---- System Prompt 拼装（与 sendTurn 同序） ----
  const systemFull =
    channel === 'sms'
      ? [
          wbBlocks.beforeSystem,
          [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
          memoryBlock,
          dynamicState,
          profileRecallBlock(contactId),
          crossBlocks?.crossAppBlock ?? '',
          crossBlocks?.groupBlock ?? '',
          momentsBlock,
          forumBlock,
          blkBlock,
          mediaRules.join('\n\n'),
          promptRule('sms-voice-call') ?? '',
          timeBlock,
          promptRule('sms-quote-ban') ?? '',
          actionDescOn ? (promptRule('sms-action-desc') ?? '') : (promptRule('sms-action-desc-off') ?? ''),
          ...visionRules,
          photoRule,
          wbBlocks.afterSystem,
          wbRulesBlock(wbBlocks),
        ]
          .filter(Boolean)
          .join('\n\n')
      : [
          wbBlocks.beforeSystem,
          [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
          memoryBlock,
          dynamicState,
          crossBlocks?.crossAppBlock ?? '',
          crossBlocks?.groupBlock ?? '',
          mtEngage.block,
          tbEngage.block,
          musicBlock,
          momentsBlock,
          forumBlock,
          coupleBlock,
          locBlock,
          avatarBlock,
          [...mtEngage.rules, ...tbEngage.rules].length > 0 ? [...mtEngage.rules, ...tbEngage.rules].join('\n\n') : '',
          blkBlock,
          quitSection,
          kickSection,
          socialRules,
          branchBlock,
          ...(mediaRules.length > 0 ? [mediaRules.join('\n\n')] : []),
          ...visionRules,
          photoRule,
          momentPostRule,
          VOICE_CALL_RULE,
          VIDEO_CALL_RULE,
          timeBlock,
          wbBlocks.afterSystem,
          wbRulesBlock(wbBlocks),
        ]
          .filter(Boolean)
          .join('\n\n');

  const sysContent = `${systemFull}\n\n${replyCount > 1 ? `${buildReplyCountPrompt(replyCount)}\n\n` : ''}${promptRule('deep-think', DEEP_THINK_RULE) ?? ''}`;

  // ---- 完整消息数组（世界书 user 块包裹同款） ----
  const messages = applyWbUserBlocks([{ role: 'system' as const, content: sysContent }, ...history], wbBlocks) as PreviewMessage[];
  pushSection('history', '聊天历史', history.map((m) => m.content).join('\n'));

  return {
    channel,
    channelLabel: CHANNEL_LABELS[channel],
    contactId,
    contactName: peer.name,
    sessionKey,
    anxietyOn: getProactiveCfg(memApp, contactId).anxietyOn !== false,
    offlineOn: !!loadMeet(contactId),
    replyCount,
    stickersOn,
    actionDescOn,
    systemFull: sysContent,
    messages,
    sections,
  };
}

/** 可选角色清单（提示词查看器的角色选择器）：微信/QQ/信息 三端通用——char + npc */
export async function listPreviewContacts(): Promise<ContactRecord[]> {
  const all = await listContacts();
  return all.filter((c) => c.kind === 'char' || c.kind === 'npc');
}

/**
 * 渠道自动推导（v72.3 查看器移除 微信/QQ/信息 标签后）：
 * 1) 该角色正打开在某个聊天里 → 用那个 App（正在聊哪就预览哪）；
 * 2) 否则取三端里「最近一条消息」时间最新的 App；
 * 3) 三端都没记录 → 兜底微信。
 * 全程同步内存读（kvGet 内存缓存 + activeChats Map），渲染期调用无副作用。
 */
export function resolvePreviewChannel(contactId: string): PreviewChannel {
  const active = getActiveProactiveChats().find((a) => a.cid === contactId);
  if (active) return active.app;
  let best: PreviewChannel = 'wx';
  let bestTime = -1;
  for (const ch of ['wx', 'qq', 'sms'] as const) {
    const msgs = kvMsgs(ch === 'sms' ? `ios-chat-msgs:c:${contactId}` : `${ch}-chat-msgs:${contactId}`);
    let last = -1;
    for (const m of msgs) {
      const t = asNum(m.time);
      if (t > last) last = t;
    }
    if (last > bestTime) {
      best = ch;
      bestTime = last;
    }
  }
  return best;
}
