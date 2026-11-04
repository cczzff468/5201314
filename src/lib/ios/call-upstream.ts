/**
 * 通话类 API 共享的上游调用层（服务端专用，/api/phone/turn 与 /api/phone/answer 共用）：
 *
 * 统一策略（只有一套逻辑，无内置模型）：
 * 永远使用设置 App「API 设置」里配置的 OpenAI 兼容接口；
 * - 公网地址 → 服务端代理转发（浏览器无感）；
 * - 内网 / 本机地址 → 返回 directOnly + 组装好的 messages，由浏览器直连
 *   （云端服务器不可达内网，见 src/lib/ios/direct-api.ts）。
 * 未配置 / 上游报错 → 内置模型（z-ai-web-dev-sdk）兜底。
 *
 * 前端直传联系人资料（联系人存浏览器本地 IndexedDB，服务端不查库）。
 */

// ---------------- 上游配置与请求 ----------------

export interface CallApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 从请求体提取上游配置：必须有 baseUrl（反代/中转接口可能无需 Key） */
export function extractUpstreamConfig(raw: unknown): UpstreamConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim() : '',
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : 'gpt-4o-mini',
    temperature: typeof r.temperature === 'number' ? r.temperature : 0.7,
    maxTokens: typeof r.maxTokens === 'number' ? r.maxTokens : 2048,
  };
}

/** 是否私有/本机地址（云端服务器大概率不可达，需浏览器直连） */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** baseUrl 归一化候选：完整端点 / /v1 结尾 / 裸域名，自动修 /v1/v1（与 /api/chat 一致） */
export function buildChatCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

/** 从任意形态的错误体提取 message（{error:{message}} / {error:"..."} / {message}） */
export function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as { error?: unknown; message?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

/** 从上游响应体提取回复文本：兼容标准 choices / {message}/{content}/{response} / SSE 文本 / 纯文本 */
export function extractReplyText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // 个别网关即使 stream:false 也返回 SSE 文本：拼接全部增量
  if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
    let acc = '';
    for (const line of trimmed.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      try {
        const chunk = JSON.parse(p) as Record<string, unknown>;
        const choices = Array.isArray(chunk.choices) ? (chunk.choices as unknown[]) : [];
        const first = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } } | undefined;
        const d = first?.delta?.content ?? first?.message?.content;
        if (typeof d === 'string') acc += d;
      } catch {
        // 忽略无法解析的行
      }
    }
    return acc.trim();
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed.slice(0, 2000);
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? (parsed.choices as unknown[]) : [];
    const first = choices[0] as
      | { message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }
      | undefined;
    const c = first?.message?.content ?? first?.delta?.content ?? first?.text;
    if (typeof c === 'string') return c.trim();
    if (Array.isArray(c)) {
      const joined = c
        .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
        .join('');
      if (joined.trim()) return joined.trim();
    }
    const msg = parsed.message as { content?: unknown } | undefined;
    if (msg && typeof msg.content === 'string') return msg.content.trim();
    if (typeof parsed.content === 'string') return parsed.content.trim();
    if (typeof parsed.response === 'string') return parsed.response.trim();
    return '';
  } catch {
    return '';
  }
}

/**
 * 内置模型兜底（z-ai-web-dev-sdk）：用户上游故障 / 未配置时把通话对话救回来，
 * 与 /api/chat、server-llm.ts 同策略；SDK 不接收 system 角色，人设并入 assistant。
 */
export async function sdkTurn(messages: CallApiMessage[]): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  // #20 通话请求超时看门狗：SDK 不接收 signal 参数，用 Promise.race 包 60s 硬超时——
  // 内置模型卡死时抛「内置模型响应超时」，让 /api/phone/turn 等路由走既有错误兜底（502 + 友好文案），
  // 前端不再永远「正在思考」
  const completion = await Promise.race([
    zai.chat.completions.create({
      messages: messages.map((m) => ({
        role: m.role === 'system' ? ('assistant' as const) : m.role,
        content: m.content,
      })),
      thinking: { type: 'disabled' },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('内置模型响应超时')), 60000);
    }),
  ]);
  const text = completion.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('内置模型返回空内容');
  return text;
}

/** 通话回复清理：去 markdown 符号 / 首尾引号包裹（TTS 朗读友好） */
export function cleanCallReply(raw: string): string {
  return raw
    .replace(/[*_`#>~[\]]/g, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim();
}

/** 上游错误 → 通话场景友好文案 */
export function friendlyUpstreamError(status: number, bodyText: string): string {
  let msg = '';
  if (bodyText.startsWith('{')) {
    try {
      msg = extractErrorMessage(JSON.parse(bodyText));
    } catch {
      // 非 JSON
    }
  }
  const REGION_BLOCKED = /country|region|territory|unsupported|blocked/i.test(msg) || /unsupported_country/i.test(bodyText);
  if (status === 401) return 'API Key 无效或未授权（401）';
  if (status === 403) {
    return REGION_BLOCKED
      ? `服务拒绝访问（403）：${msg}——请换用国内 API（DeepSeek / Kimi / 智谱 GLM）`
      : `服务拒绝访问（403）：${msg}`;
  }
  if (status === 404) return '接口路径或模型不存在（404），请到 设置 › API 设置 检查地址与模型名';
  if (status === 429) return `请求过于频繁或额度不足（429）${msg ? `：${msg}` : ''}`;
  return msg || bodyText.slice(0, 160) || `上游接口返回 ${status}`;
}

/**
 * 服务端代理调用用户自己的 API（非流式：通话需要整句文本再喂 TTS）。
 * 返回 { reply } 或 { error }。
 */
export async function callUpstream(
  config: UpstreamConfig,
  messages: CallApiMessage[]
): Promise<{ reply?: string; error?: string }> {
  const candidates = buildChatCandidates(config.baseUrl);
  const payloadBody = JSON.stringify({
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  let lastErr: unknown = null;
  let lastEndpoint = candidates[candidates.length - 1];
  for (const endpoint of candidates) {
    lastEndpoint = endpoint;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payloadBody,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      lastErr = err;
      continue;
    }
    const raw = await res.text().catch(() => '');
    if (res.ok) {
      const reply = extractReplyText(raw);
      if (reply) return { reply };
      continue; // 200 但解析不出内容：试下一个候选端点
    }
    if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) {
      continue; // 路径不存在：尝试下一个候选端点
    }
    return { error: friendlyUpstreamError(res.status, raw) };
  }
  const detail = lastErr instanceof Error && lastErr.message ? lastErr.message : '未知错误';
  return { error: `无法连接到目标 API：${detail}（实际请求端点：${lastEndpoint}）` };
}

// ---------------- 前端直传的联系人资料 ----------------

/** 前端直传的对端联系人资料（联系人已本地化，服务端不再查库）。
 *  人设字段与 PersonaSource 的 17 字段一一同名同义（height/weight/company/relationByAcc 曾长期缺失，
 *  导致电话/状态卡链路人设注入比聊天 App 少 4 个字段，现已补齐） */
export interface InlineContact {
  name: string;
  kind: string;
  gender: string | null;
  age: string | null;
  height: string | null;
  weight: string | null;
  occupation: string | null;
  company: string | null;
  region: string | null;
  persona: string | null;
  background: string | null;
  /** 表达风格（说话方式/风格基调；注入人设【表达风格】段，与 PersonaSource 同名同义） */
  expressStyle: string | null;
  /** 自定义 AI 规则（v49：一行一条；注入人设【用户定制的规则】段，优先级高于人设，与 PersonaSource 同名同义） */
  customRules: string | null;
  relation: string | null;
  /** 仅 NPC：对机主（USER）的关系 */
  relationToUser: string | null;
  /** 与角色的关系·按账号隔离（多账号关系感知）：键 = 账号 id；配合路由侧传入的 accountId
   *  取分账号关系（persona.ts relationForCtx 同口径）；老数据/未传回退全局 relation */
  relationByAcc?: Record<string, string> | null;
  /** 生日（几月几号，如 6.20 / 6月20日；注入人设前归一化） */
  birthday: string | null;
  /** 昵称（软件上显示的名字；人设注入「真名 vs 昵称」关系用） */
  nickname?: string | null;
  /** 真实姓名（展示副本 withDisplayNames 把原 name 存到这里；与 name 不同时注入真名/昵称关系） */
  realName?: string | null;
  /** 配角圈注入（由前端 npc-bond 组装）：认识的配角/归属者资料卡/背景近况 */
  ownerLabel?: string;
  npcCircle?: { name: string; relation: string; relationToUser: string; persona: string }[];
  ownerCard?: string[];
  backgroundNotes?: string[];
}

export function parseInlineContact(raw: unknown): InlineContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name.trim()) return null;
  return {
    name: c.name.trim().slice(0, 60),
    kind: typeof c.kind === 'string' ? c.kind : 'char',
    gender: typeof c.gender === 'string' ? c.gender : null,
    age: typeof c.age === 'string' ? c.age : null,
    height: typeof c.height === 'string' ? c.height : null,
    weight: typeof c.weight === 'string' ? c.weight : null,
    occupation: typeof c.occupation === 'string' ? c.occupation : null,
    company: typeof c.company === 'string' ? c.company : null,
    region: typeof c.region === 'string' ? c.region : null,
    persona: typeof c.persona === 'string' ? c.persona : null,
    background: typeof c.background === 'string' ? c.background : null,
    expressStyle: typeof c.expressStyle === 'string' ? c.expressStyle : null,
    customRules: typeof c.customRules === 'string' ? c.customRules : null,
    relation: typeof c.relation === 'string' ? c.relation : null,
    relationToUser: typeof c.relationToUser === 'string' ? c.relationToUser : null,
    relationByAcc: parseRelationByAcc(c.relationByAcc),
    birthday: typeof c.birthday === 'string' ? c.birthday : null,
    nickname: typeof c.nickname === 'string' ? c.nickname : null,
    realName: typeof c.realName === 'string' ? c.realName : null,
    ownerLabel: typeof c.ownerLabel === 'string' ? c.ownerLabel : undefined,
    npcCircle: parseNpcCircle(c.npcCircle),
    ownerCard: parseStrList(c.ownerCard),
    backgroundNotes: parseStrList(c.backgroundNotes),
  };
}

/** 前端直传的分账号关系 map（宽松解析：键/值都要是字符串，值去空；整体非法/为空 = undefined 回退全局 relation） */
function parseRelationByAcc(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = k.trim().slice(0, 40);
    if (key && typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 60);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 前端直传的配角圈条目（宽松解析，非法条目丢弃，上限 6 条） */
function parseNpcCircle(raw: unknown): { name: string; relation: string; relationToUser: string; persona: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { name: string; relation: string; relationToUser: string; persona: string }[] = [];
  for (const x of raw.slice(0, 6)) {
    if (!x || typeof x !== 'object') continue;
    const e = x as Record<string, unknown>;
    if (typeof e.name !== 'string' || !e.name.trim()) continue;
    out.push({
      name: e.name.trim().slice(0, 40),
      relation: typeof e.relation === 'string' ? e.relation.slice(0, 40) : '',
      relationToUser: typeof e.relationToUser === 'string' ? e.relationToUser.slice(0, 40) : '',
      persona: typeof e.persona === 'string' ? e.persona.slice(0, 60) : '',
    });
  }
  return out.length > 0 ? out : undefined;
}

/** 前端直传的字符串列表（宽松解析，去空，上限 4 条） */
function parseStrList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 120))
    .slice(0, 4);
  return out.length > 0 ? out : undefined;
}

/** 陌生号码的随机身份（按号码做种子，保证同人同号） */
export function unknownPersona(number: string): { name: string; persona: string } {
  const seeds = [
    { name: '陌生号码', persona: '一个打错电话的普通市民，本来想找别人，发现打错后有点抱歉，但也会随和地聊几句' },
    { name: '外卖骑手', persona: '正在送餐的外卖骑手，风风火火，说话简短急促，电话是问地址的' },
    { name: '快递员', persona: '快递员，语气公事公办，通知取件相关的事情' },
    { name: '客服小妹', persona: '某公司客服，礼貌甜美的职业腔调，做满意度回访' },
    { name: '老同学', persona: '声称是用户多年没联系的老同学，热情自来熟，想约饭叙旧' },
  ];
  let hash = 0;
  for (const ch of number) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return seeds[hash % seeds.length];
}

/** 通话对话历史（user = 机主，assistant = 对端）归一化：截尾 16 条、单条 500 字 */
export interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function normalizeHistory(value: unknown): TurnMessage[] {
  if (!Array.isArray(value)) return [];
  const out: TurnMessage[] = [];
  for (const item of value.slice(-16)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { role?: unknown; content?: unknown };
    if ((rec.role === 'user' || rec.role === 'assistant') && typeof rec.content === 'string' && rec.content.trim()) {
      out.push({ role: rec.role, content: rec.content.trim().slice(0, 500) });
    }
  }
  return out;
}

/**
 * 从 LLM 文本回复中提取决策 JSON（宽松）：抓取第一个 {...} 平衡块解析；
 * 失败返回 null（调用方走兜底）。
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
          const parsed = JSON.parse(text.slice(start, i + 1)) as unknown;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
