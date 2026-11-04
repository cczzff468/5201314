import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · AI 通话对话轮次（微信 / QQ / 电话 App 三端共用）
 * POST { contact?: { name, kind, gender, age, occupation, region, relation, persona, background },
 *        number: string, greeting?: boolean,
 *        proactiveAttempt?: number,          // AI 主动开口：用户超过几秒没说话后的第 N 次主动（1 起）
 *        history: { role: 'user' | 'assistant', content: string }[],
 *        memoryBlock?: string,               // 当前 App 记忆召回块（前端组装）
 *        crossAppBlock?: string,             // 跨 App 近况块（其他 App 最近原始消息，前端 cross-app-context 组装）
 *        groupBlock?: string,                // 群聊近况块（共同群最近原始消息，前端组装）
 *        proactiveContext?: string,          // AI 主动来电目的（非空 = 这通电话是 AI 主动拨出，注入来电目的段）
 *        callerUnknown?: boolean,            // 陌生来电（多账号）：匿名号/未登记分账号关系的小号拨出——
 *                                            // AI 不知道来电人是谁（人设换陌生来电框架，机主身份/记忆等全部不下发）
 *        worldbookBlock?: string, momentsBlock?: string, timeBlock?: string, locBlock?: string,
 *        config: { baseUrl, apiKey, model, temperature, maxTokens } }
 * 返回 { reply, name } 或 { directOnly: true, messages, name }
 * 联系人资料由前端直传（联系人存浏览器本地 IndexedDB，服务端不查库）；不传则按陌生号码处理。
 *
 * 统一策略（只有一套逻辑，无内置模型）：
 * 永远使用设置 App「API 设置」里配置的 OpenAI 兼容接口；
 * - 公网地址 → 服务端代理转发（浏览器无感）；
 * - 内网 / 本机地址 → 返回 directOnly + 组装好的 messages，由浏览器直连
 *   （云端服务器不可达内网，见 src/lib/ios/direct-api.ts）。
 * 未配置 / 上游报错 → 返回友好错误，不再回退任何内置模型。
 *
 * 话量控制（三端统一）：每次说 1~5 句，具体句数由人设性格与当下情绪决定，不固定。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import { promptTextOf } from '@/lib/prompt-entries';
import {
  type CallApiMessage,
  type InlineContact,
  callUpstream,
  cleanCallReply,
  extractUpstreamConfig,
  isPrivateHost,
  normalizeHistory,
  parseInlineContact,
  sdkTurn,
  unknownPersona,
} from '@/lib/ios/call-upstream';

/**
 * 组装通话场景 system prompt：七要素人设（名字/身份/性格/说话风格/背景/与用户的关系/禁止事项）
 * 由全 App 共用模块从联系人数据组装；这里只追加语音/视频通话场景规则。
 * multiApp：跨 App 身份感知（前端按每联系人互通开关传入；undefined=不注入）。
 * accountId：当前通话所在账号 id（多账号关系感知——小号通话用 relationByAcc[accId]，
 * 缺省 = 大号全局 relation 口径，与聊天端 activeAccountIdOf 同源）。
 * media（Task 22 视频通话）：video=视频通话——channel、场景规则、接通问候按视频分叉；默认 voice 与旧行为一致。
 */
function buildCallSystemPrompt(
  peer: PersonaSource,
  greeting: boolean,
  /** 通话方向：'out' = 用户打来的（AI 接电话方）/ 'in' = AI 打出去的（AI 主叫方）；缺省 'out' */
  direction: 'in' | 'out',
  /** AI 主动开口：用户几秒没说话后的第 N 次主动尝试（0/undefined = 正常轮次） */
  proactiveAttempt: number,
  npcExtra?: { ownerLabel?: string; npcCircle?: InlineContact['npcCircle']; ownerCard?: string[]; backgroundNotes?: string[] },
  multiApp?: boolean,
  /** 调用方附加规则（微信/QQ 语音通话注入主动挂断标记规则等；电话 App 复用同一套） */
  extraRules?: string[],
  /** 机主称呼（前端直传真名；用户规则：AI 永远不知道机主昵称，body 里的 userNickname 忽略） */
  user?: { name: string | null },
  /** 通话媒体（Task 22）：'voice'=语音通话（默认）/ 'video'=视频通话 */
  media: 'voice' | 'video' = 'voice',
  /** 多账号关系感知：当前账号 id（小号通话读 relationByAcc；不传 = 大号口径） */
  accountId?: string | null,
  /** 陌生来电（多账号）：匿名号/未登记分账号关系的小号拨出——AI 不知道来电人是谁，
   *  人设换陌生来电框架（【与X的关系】/机主称呼/多端记忆全部不下发） */
  callerUnknown?: boolean
): string {
  const base = buildPersonaSystemPrompt(peer, {
    channel: media === 'video' ? '视频通话' : '语音通话',
    userName: callerUnknown ? null : (user?.name ?? null),
    ...npcExtra,
    multiApp: callerUnknown ? undefined : multiApp,
    accountId: accountId ?? undefined,
    // 陌生来电：人设换「陌生号码来电」框架（角色自身人设/背景保留，对面的人完全未知）
    ...(callerUnknown ? { strangerMode: 'caller' as const } : {}),
    // v63 全局预设管理器：通话场景规则接入注册表（客户端经 /api/settings/prompt-state
    // 同步进服务端内存缓存，下次通话请求即生效；原始文案作 dynamicDefault 零破坏）
    extraRules: [
      promptTextOf(
        'call-length',
        { media: media === 'video' ? '视频' : '语音', mediaVerb: media === 'video' ? '视频' : '打' },
        `这是实时${media === 'video' ? '视频' : '语音'}通话：用第一人称口语化说话，像真人${media === 'video' ? '视频' : '打'}电话；每次只说 1~5 句——具体句数由你的人设性格和当下情绪决定：健谈外向的人自然多聊几句，高冷话少的人往往只说一两个短句；同一次通话里长短也可以随话题起伏变化，不要每句都一样长；一次只说一两件事；`,
      ) ?? '',
      promptTextOf(
        'call-no-emoji',
        undefined,
        '禁止任何表情符号、emoji、引号、括号、列表；只输出要说出口的话；',
      ) ?? '',
      media === 'video'
        ? (promptTextOf(
            'call-hello-video',
            undefined,
            '视频通话会互相打招呼、寒暄、自然结束（如"那我先挂了啊"）；对方说的内容要自然回应；',
          ) ?? '')
        : (promptTextOf(
            'call-hello',
            undefined,
            '打电话会互相打招呼、寒暄、自然结束（如"那我先挂了啊"）；对方说的内容要自然回应。',
          ) ?? ''),
      // 【100-d】通话内 App 操作桥接：方括号标记在通话里没有执行路径（本条规则也无解析管线），
      // 只教「口头答应 + 不假装已办」——防 AI 空口承诺发红包/放歌后又无法兑现
      promptTextOf(
        'call-app-bridge',
        undefined,
        '通话里做不了发红包/转账/放歌这类 App 操作：对方提这类需求时用一句话自然答应（比如「挂了电话我就发你」「回头发你链接」），不要假装已经发出去；',
      ) ?? '',
      ...(Array.isArray(extraRules) ? extraRules.filter((r) => typeof r === 'string' && r.trim()).slice(0, 8) : []),
      ...(proactiveAttempt >= 1
        ? [
            promptTextOf(
              'call-proactive',
              undefined,
              '对方一直没说话（可能在做别的事、走开了或没听到）。轮到你主动开口：基于你的人设、你们的关系、刚才聊到的内容和你们的记忆，自然地主动说一句（比如关心、催促、调侃、找新话题）；绝对不要重复你这次通话里已经说过的句子；',
            ) ?? '',
            ...(proactiveAttempt >= 2
              ? [
                  promptTextOf(
                    'call-proactive-again',
                    { attempt: proactiveAttempt },
                    `这已经是你第 ${proactiveAttempt} 次主动开口了对方还是没有回应：语气可以带点担心或无奈；如果你觉得对方可能真的不在，就用一句话自然告别（如「那我先挂了啊，你忙完了打给我」）并在告别语最后单独输出〔挂断〕标记。`,
                  ) ?? '',
                ]
              : []),
          ]
        : []),
    ].filter(Boolean),
  });
  if (!greeting) return base;
  // 问候视角按通话方向区分：AI 主叫（direction='in'）是「你打给对方」，
  // 不再恒定「用户刚拨通电话」——否则 AI 打来的电话它自己却说「你居然主动打给我」
  // v63：接通问候接入注册表（call-greeting-in / call-greeting-out）
  const greet =
    direction === 'in'
      ? promptTextOf(
          'call-greeting-in',
          undefined,
          '\n这通电话是你主动打给对方的：你拨出电话后对方刚刚接听。请你像主动打电话的人一样先开口（先喂一声，再自然说一句开场白，可以顺带说明你为什么打来）。',
        )
      : promptTextOf(
          'call-greeting-out',
          undefined,
          '\n现在用户刚拨通电话，请你像接到电话一样先开口打招呼（先喂一声，再说一句自然的话）。',
        );
  return greet ? base + greet : base;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const number = typeof root.number === 'string' ? root.number.trim() : '';
  if (!number) {
    return NextResponse.json({ error: '缺少号码' }, { status: 400 });
  }
  const greeting = root.greeting === true;
  // 通话方向：AI 打出去（direction='in'，来电侧）还是用户打来（缺省）——影响接通问候语的主被动视角
  const direction: 'in' | 'out' = root.direction === 'in' ? 'in' : 'out';
  // 通话媒体（Task 22 视频通话）：video=视频通话——channel/场景规则/接通问候按视频分叉；默认语音
  const media: 'voice' | 'video' = root.media === 'video' ? 'video' : 'voice';
  const proactiveAttempt = typeof root.proactiveAttempt === 'number' && Number.isFinite(root.proactiveAttempt)
    ? Math.max(0, Math.min(9, Math.floor(root.proactiveAttempt)))
    : 0;
  const history = normalizeHistory(root.history);

  // 解析对端身份：前端直传的联系人资料 / 陌生号码（联系人存本地 IndexedDB，服务端不查库）
  const inline = parseInlineContact(root.contact);
  const peer: PersonaSource = inline
    ? {
        name: inline.name,
        kind: inline.kind,
        gender: inline.gender,
        age: inline.age,
        height: inline.height,
        weight: inline.weight,
        occupation: inline.occupation,
        company: inline.company,
        region: inline.region,
        persona: inline.persona,
        background: inline.background,
        expressStyle: inline.expressStyle,
        customRules: inline.customRules,
        relation: inline.relation,
        relationByAcc: inline.relationByAcc ?? null,
        relationToUser: inline.relationToUser,
        birthday: inline.birthday,
        nickname: inline.nickname ?? null,
        realName: inline.realName ?? null,
      }
    : (() => {
        const p = unknownPersona(number);
        return { name: p.name, persona: p.persona };
      })();
  const peerName = peer.name;
  // 多账号关系感知：前端按当前通话账号传入（activeAccountIdOf）；不传 = 大号口径（零破坏）
  const accountId = typeof root.accountId === 'string' && root.accountId.trim() ? root.accountId.trim().slice(0, 40) : undefined;
  // 陌生来电（多账号）：匿名号/未登记分账号关系的小号拨出的电话——AI 不知道来电人是谁。
  // 仅由前端在「用户拨出 + 电话 App」链路传入；AI 主动来电（direction='in'）不适用（AI 打给它认识的联系人）
  const callerUnknown = root.callerUnknown === true;

  const system = buildCallSystemPrompt(
    peer,
    greeting,
    direction,
    proactiveAttempt,
    {
      ownerLabel: inline?.ownerLabel,
      npcCircle: inline?.npcCircle,
      ownerCard: inline?.ownerCard,
      backgroundNotes: inline?.backgroundNotes,
    },
    root.multiApp === true || root.multiApp === false ? (root.multiApp as boolean) : undefined,
    Array.isArray(root.extraRules) ? (root.extraRules as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
    // 机主称呼：前端直传真名（用户规则：AI 永远不知道机主昵称——body 里的 userNickname 直接忽略；
    // 陌生来电不下发任何机主身份：AI 不知道对面是谁）
    callerUnknown
      ? undefined
      : (() => {
          const real = typeof root.userRealName === 'string' ? root.userRealName.trim() : '';
          return real ? { name: real } : undefined;
        })(),
    // 通话媒体（Task 22 视频通话）：channel 与场景规则按此分叉
    media,
    // 多账号关系感知：小号通话读分账号关系，不再恒用大号全局 relation
    accountId,
    // 陌生来电（多账号）：匿名号/未登记小号拨出——人设换陌生框架、机主身份不下发
    callerUnknown
  );
  // 记忆库：前端传入的跨 App 记忆块（互通开关范围已由前端过滤），附加在人设之后
  const memoryBlock = typeof root.memoryBlock === 'string' ? root.memoryBlock.trim() : '';
  // 跨 App 近况块：其他 App 最近原始消息（前端 cross-app-context 组装，含【当前环境】行——AI 知道在哪个 App）
  const crossAppBlock = typeof root.crossAppBlock === 'string' ? root.crossAppBlock.trim() : '';
  // 群聊近况块：共同群最近原始消息（已标注群名与发言人，前端按群 ID 隔离读取）
  const groupBlock = typeof root.groupBlock === 'string' ? root.groupBlock.trim() : '';
  // AI 主动来电目的（另一任务写入）：非空 = 这通电话是 AI 主动打来的，注入来电目的段
  const proactiveContext = typeof root.proactiveContext === 'string' ? root.proactiveContext.trim() : '';
  const proactiveBlock = proactiveContext
    ? `【来电目的】这通电话是你主动打来的，你打电话来是想：${proactiveContext}。自然地围绕这个目的开启对话。`
    : '';
  // 世界书块：前端与文字聊天同一套 collectWbBlocks 组装（全局/局部/专属命中条目 + 使用规则），
  // 附加在人设之后、记忆之前（优先级：人设/世界设定 > 记忆，与文字聊天 systemFull 顺序一致）
  const worldbookBlock = typeof root.worldbookBlock === 'string' ? root.worldbookBlock.trim() : '';
  // 社交动态块：前端按互通开关现场构建的「最近朋友圈/QQ动态 + 相关互动」（动态与聊天记忆双向打通）
  const momentsBlock = typeof root.momentsBlock === 'string' ? root.momentsBlock.trim() : '';
  // 归属红线（用户实测：语音通话里 AI 把自己发的朋友圈当成对方发的，「朋友圈看到你说…」）：
  // 通话场景的动态信息有两个来源——社交动态块（自带归属标注+尾注）与记忆碎片（char-post 句式带
  // 「（AI角色本人）」标注），两者模型都可能看反；system 级规则无条件再压一次（陌生来电不下发身份，
  // 规则一并省略）。措辞覆盖「动态内容里提到对方」这种最易看反的形态
  const momentsRule = callerUnknown
    ? ''
    : '【社交动态归属红线】你的记忆和社交动态里提到的朋友圈/QQ空间动态都带归属标注：「（AI角色本人）」= 你自己发的，就算动态内容里提到了对方，发动态的人也是你自己，绝不能说成「在朋友圈看到你发了/你说」；「（用户本人）」的才是对方发的。开口提任何动态前先确认归属，看不清就不提。';
  // 时间感知块：前端按联系人开关现场构建（当前时间/季节/节日/事件时长/上次聊天间隔），附加在记忆之后
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';
  // 位置感知块：前端与文字聊天同一套 buildLocationBlock（用户最近发过的位置：名称/地址/经纬度/时间）
  const locBlock = typeof root.locBlock === 'string' ? root.locBlock.trim() : '';
  // 用户画面识图块（Task 22 视频通话）：前端视频通话中采集的摄像头帧识图描述（非空才注入）——
  // AI 知道此刻对方的摄像头里是什么（人/表情/动作/环境），可像真人视频一样自然回应画面内容
  const visionBlock = typeof root.visionBlock === 'string' ? root.visionBlock.trim() : '';
  const visionBlockFull = visionBlock
    ? `【用户画面（视频通话实时识图）】这是对方摄像头此刻拍到的画面（每隔几秒刷新，可能略有延迟）：${visionBlock}`
    : '';
  // 拼装顺序（Task 40-b 注入约定）：人设 → 世界书 → 当前 App 记忆 → 跨 App 近况 → 群聊近况 →
  // 来电目的（主动电话）→ 动态 → 归属红线 → 时间 → 位置 → 用户画面（视频识图，离对话最近放最后）；空串/缺字段自动跳过
  const systemFull = [system, worldbookBlock, memoryBlock, crossAppBlock, groupBlock, proactiveBlock, momentsBlock, momentsRule, timeBlock, locBlock, visionBlockFull]
    .filter(Boolean)
    .join('\n\n');

  // 上游要求 messages 必须以 user 消息收尾：
  // - 普通轮次：历史本身以用户刚说的话收尾，直接透传；
  // - 接通问候 / AI 主动开口：补一条 user 消息触发开口。
  const messages: CallApiMessage[] = [{ role: 'system', content: systemFull }, ...history];
  if (greeting && (messages.length === 1 || messages[messages.length - 1].role !== 'user')) {
    messages.push({
      role: 'user',
      content:
        direction === 'in'
          ? '（你拨出的电话对方已接听，请先开口说话）'
          : callerUnknown
            ? '（一个陌生号码拨通了你的电话，你不认识对方。请像接到陌生来电一样先开口打招呼）'
            : '（电话已拨通，请先开口打招呼）',
    });
  } else if (!greeting && messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    // 兜底：正常轮次历史不该以 assistant 收尾，补一条 user 触发回应
    messages.push({ role: 'user', content: proactiveAttempt >= 1 ? '（对方迟迟没有说话，请主动开口）' : '（请继续用口语回应）' });
  }

  // ---------- 统一走用户自己的 API；未配置 / 上游故障时内置模型兜底 ----------
  const config = extractUpstreamConfig(root.config);

  /** 内置模型兜底：把人设/记忆/时间块照常注入，保证通话体验不中断；viaSdk 供前端统计 */
  const sdkFallback = async (): Promise<NextResponse> => {
    try {
      const reply = cleanCallReply(await sdkTurn(messages));
      if (reply) return NextResponse.json({ reply, name: peerName, viaSdk: true });
      return NextResponse.json({ error: '对方没有回应，请稍后再试' }, { status: 502 });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      return NextResponse.json({ error: `内置模型也不可用：${detail}` }, { status: 502 });
    }
  };

  if (!config) {
    // 未配置也能通话：直接内置模型接听
    return sdkFallback();
  }
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return NextResponse.json({ error: 'API 地址无法解析，请到 设置 › API 设置 检查' }, { status: 400 });
  }
  // 内网 / 本机地址：云端服务器必然不可达 → 交给浏览器直连（返回组装好的 messages）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ directOnly: true, messages, name: peerName });
  }
  // 公网地址：服务端代理转发（对浏览器透明，同一套逻辑）
  const result = await callUpstream(config, messages);
  if (result.reply) {
    // 去掉可能出现的 markdown 符号/首尾引号包裹
    const reply = cleanCallReply(result.reply);
    if (reply) return NextResponse.json({ reply, name: peerName });
  }
  // 上游故障（连接失败/401/403/404/429/空回复）：内置模型兜底，通话不中断
  return sdkFallback();
}
