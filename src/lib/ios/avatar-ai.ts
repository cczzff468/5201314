'use client';

/**
 * 头像 AI 感知（第二十九轮「让 AI 知道头像长什么样 / AI 主动换头像」）：
 *
 * 两件事：
 * ① 头像变化感知——任何一方（机主在微信/QQ 资料页换头像、AI 用 [换头像]/[生成新头像] 换头像）
 *    都把「新头像的识图描述 + 更换时间」写进 kv（avatar-desc:{contactId}），并在下一轮聊天时
 *    经 buildAvatarBlock 注入 system prompt：AI 知道自己现在的头像长什么样、也知道用户换了头像
 *    且头像长什么样（识图失败先落「暂无描述」，之后 AI 回合会懒补描述）；
 *    机主换头像同时给绑定的恋人角色写一条事件记忆（memAddEventFragment）——AI 之后能自然提起
 *    「你换头像了」这件事，而不只是当场看见。
 * ② 描述懒补——readAvatarDesc 发现只有时间没有描述时，由聊天回合开头 fire-and-forget 补识图。
 *
 * 存储键（kv store，全局共享不做 App 隔离——头像描述是「这个人长什么样」的事实，跨端通用）：
 *   avatar-desc:{contactId} → { desc: string; at: number }
 */

import { kvGet, kvSet } from './idb-kv';
import { useSettings } from './store';
import { describeImagesAuto } from '@/lib/vision-client';
import { memAddEventFragment } from '@/lib/memory';
import { readInviteMeta } from './couple-invite';
import type { MemApp } from '@/lib/memory-core';

export interface AvatarDescInfo {
  /** 头像内容描述（识图产出；空串 = 还没描述成功，待懒补） */
  desc: string;
  /** 更换时间戳 */
  at: number;
}

const DESC_KEY = (contactId: string) => `avatar-desc:${contactId}`;

/** 读某联系人的头像描述记录（无记录返回 null） */
export function readAvatarDesc(contactId: string): AvatarDescInfo | null {
  if (!contactId) return null;
  try {
    const v = kvGet<AvatarDescInfo>(DESC_KEY(contactId));
    if (v && typeof v.at === 'number') return { desc: typeof v.desc === 'string' ? v.desc : '', at: v.at };
  } catch {
    /* 静默 */
  }
  return null;
}

function writeAvatarDesc(contactId: string, info: AvatarDescInfo): void {
  try {
    kvSet(DESC_KEY(contactId), info);
  } catch {
    /* 写入失败静默（感知能力缺失不影响主流程） */
  }
}

/** 时间格式化：M月D日（头像块展示用） */
function fmtDay(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

/**
 * 记录一次头像更换（换完头像后调用，fire-and-forget）：
 * - 先落「时间已知、描述待补」的记录（AI 立刻知道换过头像）；
 * - 再异步识图补描述（describeImagesAuto：未配置识图模型自动用内置兜底）；
 * - who='me' 时给绑定的恋人角色写一条事件记忆（「换了头像，头像样子是…」），
 *   描述补出来后更新记忆由下次换头像自然覆盖（记忆碎片按 sourceTag 去重合并）。
 * @param contactId 换头像的联系人 id（机主=me.id，AI 角色=peer.id）
 * @param app       触发换头像的 App（记忆归属口径）
 * @param src       新头像 dataURL
 * @param who       'me'=机主本人换的 / 'peer'=AI 角色换的
 * @param preDesc   已知的描述（如 AI 生图时的 job.desc）——传了就不再识图
 */
export function noteAvatarChanged(contactId: string, app: MemApp, src: string, who: 'me' | 'peer', preDesc?: string): void {
  if (!contactId || typeof src !== 'string' || !src.startsWith('data:image/')) return;
  const at = Date.now();
  const info: AvatarDescInfo = { desc: (preDesc ?? '').trim(), at };
  writeAvatarDesc(contactId, info);
  // ① 已有描述（生图任务自带）：直接完成落库
  if (info.desc) {
    if (who === 'me') rememberOwnerAvatar(app, info.desc, at);
    return;
  }
  // ② 描述待补：异步识图（失败保留空串，下次 AI 回合懒补）
  void (async () => {
    try {
      const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
        images: [src],
        text: '这是一张聊天软件头像，请用一句话客观描述头像画面内容（人物/动物/景物/文字等），40字以内。',
      });
      if (!desc) return;
      const cur = readAvatarDesc(contactId);
      // 识图期间头像又换过（at 变了）就不覆盖新记录
      if (cur && cur.at !== at) return;
      writeAvatarDesc(contactId, { desc, at });
      if (who === 'me') rememberOwnerAvatar(app, desc, at);
    } catch {
      /* 识图失败静默：描述留空，懒补机制兜底 */
    }
  })();
}

/** 机主换头像 → 给绑定的恋人角色写事件记忆（AI 之后能自然提起这件事） */
function rememberOwnerAvatar(app: MemApp, desc: string, at: number): void {
  try {
    const partnerId = readInviteMeta().partnerContactId;
    if (!partnerId) return;
    memAddEventFragment(
      partnerId,
      app,
      `机主换了一张新头像（头像画面：${desc.slice(0, 60)}）`,
      { eventTime: at, sourceTag: 'owner-avatar' },
    );
  } catch {
    /* 静默 */
  }
}

/**
 * 头像描述懒补（聊天回合开头 fire-and-forget 调用）：
 * 记录存在但描述为空（上次识图失败/还没来得及识图）→ 补一次识图并落盘。
 * @param contactId 联系人 id
 * @param src 当前头像 dataURL（从联系人记录实时取，避免用旧图描述新头像）
 * @param who 描述归属（记忆写入方向，同 noteAvatarChanged）
 */
export function ensureAvatarDesc(contactId: string, app: MemApp, src: string, who: 'me' | 'peer'): void {
  const cur = readAvatarDesc(contactId);
  if (!cur || cur.desc) return;
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return;
  void (async () => {
    try {
      const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
        images: [src],
        text: '这是一张聊天软件头像，请用一句话客观描述头像画面内容（人物/动物/景物/文字等），40字以内。',
      });
      if (!desc) return;
      const now = readAvatarDesc(contactId);
      if (now && now.desc) return; // 别处已补
      writeAvatarDesc(contactId, { desc, at: now?.at ?? Date.now() });
      if (who === 'me') rememberOwnerAvatar(app, desc, now?.at ?? Date.now());
    } catch {
      /* 静默 */
    }
  })();
}

/**
 * 组装【头像近况】system 块（聊天回合注入；双方都没有头像记录时返回空串不占 token）：
 * AI 由此知道①自己头像长什么样 ②用户头像长什么样、什么时候换的——
 * 并被要求像真人一样自然注意到对方换头像（不装没看见、不编造没发生的变化）。
 */
export function buildAvatarBlock(peerCid: string, meCid: string, userLabel: string): string {
  const peerDesc = readAvatarDesc(peerCid);
  const meDesc = readAvatarDesc(meCid);
  if (!peerDesc && !meDesc) return '';
  const lines: string[] = ['【头像近况】（你们俩的头像状态，都是真实发生的）'];
  if (peerDesc) {
    lines.push(
      `- 你的头像：${peerDesc.desc || '（画面内容你还没看过，不要编造）'}（${fmtDay(peerDesc.at)}设置的）。这是你自己设置的头像，聊天里可以自然提到自己的头像/形象。`,
    );
  }
  if (meDesc) {
    lines.push(
      `- ${userLabel}的头像：${meDesc.desc || '（画面内容你还没看过，不要编造）'}（${fmtDay(meDesc.at)}更换的）。` +
        `${userLabel}最近换过头像——像真人一样自然注意到并回应这件事（夸/调侃/问细节都行，符合你的人设和你们的关系），不要装作没看见，也不要编造没发生过的头像变化。`,
    );
  }
  return lines.join('\n');
}
