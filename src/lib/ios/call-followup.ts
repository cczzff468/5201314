'use client';

/**
 * 挂断后 AI 续聊文字（三端共用客户端封装）：
 *
 * 通话引擎在挂断收尾时调用，生成「AI 继续发的文字」——条数上限 = 该会话聊天设置里的回复条数
 * （replyCount 由调用方按 sessionKey 现场读取直传；上限不是任务，没话可以少发），
 * 依据：人设 + 本次通话内容 + 相关记忆（动态召回）+ 最近聊天 + 时间感知（服务端 /api/phone/followup 组装）。
 * 另可携带跨 App 近况块与群聊近况块（crossAppBlock/groupBlock，前端 cross-app-context 组装；
 * 服务端按「人设 > 世界书 > 记忆 > 跨 App > 群聊 > 时间」拼装）。
 * 呈现由宿主负责：微信/QQ 以聊天消息落盘，电话 App 以语音留言呈现（无聊天面板，与拒接解释同机制）。
 *
 * 续聊文字同时并入通话转写 → 挂断总结把「通话内容 + 续聊文字」一起沉淀入记忆
 * （与文字记忆同池互通、按联系人隔离）；下次聊天或通话时都能引用。
 *
 * 任何失败静默返回 []：续聊是体验增强，绝不阻塞挂断收尾。
 */

import { useSettings } from './store';
import { directChatStream } from './direct-api';
import { extractThinkBlocks } from '@/lib/think-filter';

/** 前端直传的联系人资料（与 turn API 的 InlineContact 同形；联系人存浏览器本地 IndexedDB） */
export interface CallFollowupContact {
  name: string;
  kind: string;
  gender: string | null;
  age: string | null;
  height?: string | null;
  weight?: string | null;
  occupation: string | null;
  company?: string | null;
  region: string | null;
  relation: string | null;
  /** 与角色的关系·按账号隔离（多账号关系感知；配合 payload.accountId 取分账号关系） */
  relationByAcc?: Record<string, string> | null;
  relationToUser: string | null;
  birthday: string | null;
  persona: string | null;
  background: string | null;
  /** 昵称（软件上显示的名字；人设注入「真名 vs 昵称」关系用） */
  nickname?: string | null;
  /** 真实姓名（与 name 不同时注入真名/昵称关系，被问是谁报真名） */
  realName?: string | null;
  /** 说话风格（联系人卡的最高优先级口吻字段；回访跟进沿用同人设口径） */
  expressStyle?: string | null;
}

export interface CallFollowupTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallFollowupPayload {
  contact: CallFollowupContact | null;
  direction: 'out' | 'in';
  /** 挂断原因：ai-hangup / hangup / reject / missed-in / cancel（服务端映射场景说明） */
  endReason: string;
  connected: boolean;
  duration: number;
  /** 本次通话转写（user=机主 / assistant=AI；未接通传 []） */
  transcript: CallFollowupTurn[];
  /** 通话前的最近聊天上下文（引擎发起时快照；电话 App 无聊天面板传 []） */
  recentChat: CallFollowupTurn[];
  /** 动态召回的记忆块（宿主按联系人组装；互通开关范围已过滤） */
  memoryBlock?: string;
  /** 跨 App 近况块（其他 App 最近原始消息；Task 40-b，前端 cross-app-context 组装；空缺不注入） */
  crossAppBlock?: string;
  /** 群聊近况块（共同群最近原始消息，已标注群名与发言人；空缺不注入） */
  groupBlock?: string;
  worldbookBlock?: string;
  timeBlock?: string;
  multiApp?: boolean;
  /** 续聊条数上限（第四十四轮起恒为 1：挂断后只留一条言，全部想说的话在这条里说完；传值仅为兼容旧调用点） */
  replyCount?: number;
  /** 通话媒体（Task 22 视频通话）：video=视频通话——服务端补媒体说明，AI 续聊文字按视频口径；缺省语音 */
  media?: 'voice' | 'video';
  /** 机主称呼（真实名字；用户规则：AI 永远不知道机主昵称，userNickname 不再下传） */
  userRealName?: string;
  /** 多账号关系感知：当前账号 id（小号续聊读分账号关系；不传 = 大号口径） */
  accountId?: string;
  /** 陌生来电（多账号）：匿名号/未登记分账号关系的小号拨出——AI 不知道来电人是谁，
   *  续聊按「刚接到一通陌生电话」框架（机主身份/关系/多端记忆不下发） */
  callerUnknown?: boolean;
}

/** 条数硬约束（第四十四轮）：挂断后 AI 只留一条留言——把想说的全部说完在这条里；
 *  此前按会话「回复条数」上限多发（回退 2），用户反馈要只留一次言；兼容旧调用点仍接收 replyCount 但不再消费 */
function followupMax(_n: unknown): number {
  return 1;
}

/** 从模型文本提取续聊留言（宽松：JSON 平衡块优先，失败按行拆；去标记/符号/包裹引号）。
 *  第四十四轮：max≤1 时把模型拆出的多段合并为一条（标点缺失自动补句号），内容截断上限 600 字——
 *  「一条把全部想说的说完」不被 200 字旧上限腰斩 */
export function parseFollowupText(raw: string, max = 2): string[] {
  // [思考]块兜底剥离（A1）：续聊链路未注入思考指令，但模型跨链路模仿单聊输出习惯时
  // 会在正文/JSON 前裹 [思考]…[/思考]——不过一遍会原样泄漏进聊天气泡/语音留言朗读
  const rawClean = extractThinkBlocks(raw ?? '').text;
  const cap = max <= 1 ? 600 : 200;
  const clean = (s: string) =>
    s
      .replace(/〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g, '')
      .replace(/[*_`#>~[\]]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim()
      .slice(0, cap);
  const mergeToOne = (list: string[]): string[] => {
    if (max > 1 || list.length <= 1) return list.slice(0, max);
    // 多段合一条：前段无结尾标点时补句号，避免硬拼接粘句
    let joined = '';
    for (const seg of list) {
      if (!joined) joined = seg;
      else joined += /[。！？…~～!?]$/.test(joined) ? seg : `。${seg}`;
    }
    return [joined.slice(0, cap)];
  };
  const start = rawClean.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < rawClean.length; i++) {
      const ch = rawClean[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(rawClean.slice(start, i + 1)) as { messages?: unknown };
            if (obj && Array.isArray(obj.messages)) {
              const out = (obj.messages as unknown[])
                .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                .map(clean)
                .filter(Boolean);
              if (out.length > 0) return mergeToOne(out);
            }
          } catch {
            // JSON 不完整：走按行兜底
          }
          break;
        }
      }
    }
  }
  return mergeToOne(
    rawClean
      .split('\n')
      .map((l) => clean(l))
      .filter(Boolean),
  );
}

/** 请求挂断续聊文字（fire-and-forget 友好：所有失败静默返回 []，由调用方决定总结时序） */
export async function requestCallFollowup(p: CallFollowupPayload): Promise<string[]> {
  const max = followupMax(p.replyCount);
  try {
    const res = await fetch('/api/phone/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, replyCount: max, config: useSettings.getState().apiConfig }),
      // #20 通话链路超时看门狗：续聊请求 45s 到点必失败（AbortSignal.timeout → DOMException TimeoutError），
      // 上游卡死不再拖住挂断收尾；本函数 catch 后静默返回 []，文案无需进 UI
      signal: AbortSignal.timeout(45000),
    });
    const data = (await res.json()) as {
      messages?: unknown;
      directOnly?: boolean;
      error?: string;
    };
    // 内网 API：浏览器直连流式（与通话轮次同策略），取全量文本再解析
    if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
      try {
        const full = await directChatStream(useSettings.getState().apiConfig, data.messages as Parameters<typeof directChatStream>[1], () => undefined);
        return parseFollowupText(full, max);
      } catch {
        return [];
      }
    }
    if (res.ok && Array.isArray(data.messages)) {
      // 服务端直接产出的续聊文字：同口径过一遍思考块剥离（防御缺口 A1，与 parseFollowupText 一致）
      return (data.messages as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => extractThinkBlocks(x).text.trim().slice(0, max <= 1 ? 600 : 200))
        .slice(0, max);
    }
    return [];
  } catch {
    return [];
  }
}
