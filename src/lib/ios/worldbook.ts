/**
 * 世界书（World Book / Lorebook）—— 按关键词触发的静态设定库。
 *
 * 整体链路（「给 AI 挂载静态设定和世界观」需求）：
 * 1. 用户在「世界书」App 里维护若干本书，每本书含若干条目（触发词 + 设定内容）；
 * 2. 范围（scope）属于**世界书本体**（不是条目）：
 *    - global    全局：所有对话生效，**无需关键词触发**（内容常驻注入），适合世界观框架、基础设定；
 *    - local     局部：命中关键词才注入，且仅当本书被挂载到当前聊天（聊天设置里挂载）；
 *    - exclusive 专属：命中关键词才注入，仅对绑定的那个角色生效（无需挂载）；
 * 3. 书级「启用」总开关：关闭后整本书永不注入（条目级开关仍可单独停用条目）；
 * 4. 每次发送消息时扫描最近上下文，命中任一触发词且处于启用状态的条目被激活（全局书无需触发词）；
 * 5. 激活条目按书独立包裹成【世界设定开始】/【世界设定结束】块：按「插入位置」分组，
 *    书内同位置按「优先级」降序排列，同一位置上多本书按 全局→专属→局部 排列，
 *    各书独立成块互不穿插；六个位置合计有总预算（WB_INJECT_BUDGET）防超长；
 * 6. 有世界书内容注入时，system 末尾同步注入「世界设定使用规则」（wbRulesBlock）：
 *    使用规则 + 信息优先级（系统规则＞世界书＞人设＞记忆＞聊天记录＞新消息）+ 冲突处理；
 * 7. 未命中的条目不参与发送——世界书内容不进记忆库，两者完全独立。
 *
 * 插入位置（position，决定激活内容注入到提示词的哪个部分）：
 * - before_system 系统提示词之前 / after_system 系统提示词之后
 * - before_char   角色定义之前   / after_char   角色定义之后
 * - before_user   用户消息之前   / after_user   用户消息之后（包裹最后一条用户消息）
 *
 * 存储：书籍全量存 IndexedDB kv（键 worldbooks）；联系人挂载关系按联系人隔离
 * （键 wb-bind:<contactId>）。读写走 @/lib/ios/idb-kv 的内存写穿层（与朋友圈/记忆同层）。
 * 兼容旧版数据：旧结构把 scope 放在条目上，loadBooks 时自动归一化到书级。
 */

import { hasEmoji } from '@/lib/emoji';
import { promptTextOf } from '@/lib/prompt-entries';
import { kvDel, kvGet, kvSet } from './idb-kv';

// ---------------- 类型 ----------------

export const WB_POSITIONS = [
  'before_system',
  'after_system',
  'before_char',
  'after_char',
  'before_user',
  'after_user',
] as const;
export type WbPosition = (typeof WB_POSITIONS)[number];

export const WB_POSITION_LABELS: Record<WbPosition, string> = {
  before_system: '系统提示词之前',
  after_system: '系统提示词之后',
  before_char: '角色定义之前',
  after_char: '角色定义之后',
  before_user: '用户消息之前',
  after_user: '用户消息之后',
};

export const WB_SCOPES = ['global', 'local', 'exclusive'] as const;
export type WbScope = (typeof WB_SCOPES)[number];

export const WB_SCOPE_LABELS: Record<WbScope, string> = {
  global: '全局',
  local: '局部',
  exclusive: '专属',
};

/** 范围选择卡片副标题（新建弹窗里的三选卡片） */
export const WB_SCOPE_SUBTITLES: Record<WbScope, string> = {
  global: '所有对话生效 · 无需关键词',
  local: '命中关键词 · 当前会话生效',
  exclusive: '绑定角色 · 命中关键词生效',
};

/** 详情页头部一句话说明（短版） */
export const WB_SCOPE_SHORT_DESC: Record<WbScope, string> = {
  global: '所有对话都生效，无需关键词触发',
  local: '挂载后生效，命中关键词才注入',
  exclusive: '仅对绑定的角色生效，命中关键词才注入',
};

/** 设置卡下方的用途提示（适合…） */
export const WB_SCOPE_TIPS: Record<WbScope, string> = {
  global: '适合世界观框架、基础设定',
  local: '适合剧情事件、场景细节',
  exclusive: '适合角色专属设定、角色私设',
};

/** 条目结构（条目名字仅本地显示，不发送给 AI；范围在书级，条目不再带 scope） */
export interface WbEntry {
  id: string;
  /** 开关：关闭后永不发送 */
  enabled: boolean;
  /** 条目名字（仅本地显示） */
  name: string;
  /** 触发词：一个或多个关键词，命中任一即激活（全局书无需触发词，可留空） */
  keywords: string[];
  /** 内容：激活后插入的设定文本 */
  content: string;
  /** 插入位置 */
  position: WbPosition;
  /** 优先级：同一位置多条命中时数字大的排前面 */
  priority: number;
  /** 触发词匹配是否忽略大小写 */
  ignoreCase: boolean;
}

export interface WorldBook {
  id: string;
  name: string;
  /** 书级启用总开关：关闭后整本书永不注入 */
  enabled: boolean;
  /** 书级范围：全局（常驻注入）/ 局部（挂载后关键词触发）/ 专属（绑定角色关键词触发） */
  scope: WbScope;
  /** scope === 'exclusive' 时绑定的联系人 id */
  targetContactId: string | null;
  entries: WbEntry[];
  createdAt: number;
  updatedAt: number;
}

// ---------------- 存储（kv 内存写穿层） ----------------

const BOOKS_KEY = 'worldbooks';

/** 联系人挂载的书籍 id 列表（按联系人隔离） */
export const wbBindKey = (contactId: string): string => `wb-bind:${contactId}`;

/** 旧版原始形状（scope 在条目上；书可能缺 enabled/scope 字段）——仅用于迁移归一化 */
interface RawLegacyEntry extends Partial<WbEntry> {
  scope?: unknown;
  targetContactId?: unknown;
}

interface RawLegacyBook extends Omit<Partial<WorldBook>, 'entries'> {
  entries?: RawLegacyEntry[];
}

function isWbScope(v: unknown): v is WbScope {
  return v === 'global' || v === 'local' || v === 'exclusive';
}

/** 旧数据归一化：书级 scope 缺失时按条目旧 scope 推断（专属 > 局部 > 全局），条目上的 scope 字段剥离 */
function normalizeRawBook(raw: RawLegacyBook): WorldBook {
  const legacyEntries = Array.isArray(raw.entries) ? raw.entries : [];
  const entries: WbEntry[] = legacyEntries.map((e) => {
    const base: WbEntry = {
      id: typeof e.id === 'string' ? e.id : newWbId('wbe'),
      enabled: e.enabled !== false,
      name: typeof e.name === 'string' ? e.name : '',
      keywords: Array.isArray(e.keywords) ? e.keywords.filter((k): k is string => typeof k === 'string') : [],
      content: typeof e.content === 'string' ? e.content : '',
      position: isWbPosition(e.position) ? e.position : 'after_char',
      priority: typeof e.priority === 'number' && Number.isFinite(e.priority) ? Math.floor(e.priority) : 0,
      ignoreCase: e.ignoreCase !== false,
    };
    return base;
  });

  let scope = raw.scope;
  let targetContactId = typeof raw.targetContactId === 'string' ? raw.targetContactId : null;
  if (!isWbScope(scope)) {
    // 旧版推断：有专属条目 → 专属（取第一个专属目标）；否则有局部条目 → 局部；否则全局
    const legacy = legacyEntries as Array<RawLegacyEntry | undefined>;
    const ex = legacy.find((e) => e?.scope === 'exclusive');
    if (ex) {
      scope = 'exclusive';
      targetContactId = typeof ex.targetContactId === 'string' ? ex.targetContactId : null;
    } else if (legacy.some((e) => e?.scope === 'local')) {
      scope = 'local';
      targetContactId = null;
    } else {
      scope = 'global';
      targetContactId = null;
    }
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : newWbId('wb'),
    name: typeof raw.name === 'string' ? raw.name : '未命名世界书',
    enabled: raw.enabled !== false,
    scope,
    targetContactId,
    entries,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function isWbPosition(v: unknown): v is WbPosition {
  return (WB_POSITIONS as readonly string[]).includes(typeof v === 'string' ? v : '');
}

export function loadBooks(): WorldBook[] {
  const raw = kvGet<WorldBook[]>(BOOKS_KEY);
  if (!Array.isArray(raw)) return [];
  // 兼容旧结构（scope 在条目上）：读入时归一化；下次保存即落为新结构
  return raw.map((b) => normalizeRawBook(b as RawLegacyBook));
}

export function saveBooks(books: WorldBook[]): void {
  kvSet(BOOKS_KEY, books);
}

export function getBook(books: WorldBook[], bookId: string): WorldBook | null {
  return books.find((b) => b.id === bookId) ?? null;
}

export function getBoundBookIds(contactId: string): string[] {
  const raw = kvGet<string[]>(wbBindKey(contactId));
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
}

export function setBoundBookIds(contactId: string, ids: string[]): void {
  kvSet(wbBindKey(contactId), [...new Set(ids)]);
}

/** 删除联系人时清理挂载关系（书籍本体与条目是用户创作，保留不删） */
export function clearContactBinding(contactId: string): void {
  kvDel(wbBindKey(contactId));
}

/** 删除世界书时，把该书从所有联系人的挂载列表里摘除（避免残留失效的挂载 id） */
export async function pruneBookFromAllBindings(bookId: string): Promise<void> {
  try {
    const { listContacts } = await import('./contacts-store');
    const contacts = await listContacts();
    for (const c of contacts) {
      const ids = getBoundBookIds(c.id);
      if (ids.includes(bookId)) setBoundBookIds(c.id, ids.filter((x) => x !== bookId));
    }
  } catch {
    // 联系人不可用时静默：失效挂载 id 不影响注入（collectWbBlocks 以现存书籍为准）
  }
}

export function newWbId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- 校验 ----------------

/** 世界书名字校验：非空且不含 emoji（条目名字无此限制，可随便取） */
export function wbNameCheck(name: string): { ok: boolean; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: '世界书名字不能为空' };
  if (hasEmoji(trimmed)) return { ok: false, reason: '世界书名字不能包含 emoji' };
  if (trimmed.length > 30) return { ok: false, reason: '世界书名字不能超过 30 个字' };
  return { ok: true, reason: '' };
}

/**
 * 条目保存校验：内容非空；局部/专属书还要求至少 1 个触发词
 * （全局书内容常驻注入、不扫描触发词，触发词可留空）。
 */
export function wbEntryCheck(
  entry: Pick<WbEntry, 'keywords' | 'content'>,
  opts?: { requireKeywords?: boolean },
): { ok: boolean; reason: string } {
  const requireKeywords = opts?.requireKeywords !== false;
  if (requireKeywords && entry.keywords.length === 0) return { ok: false, reason: '至少填写 1 个触发词' };
  if (!entry.content.trim()) return { ok: false, reason: '内容不能为空' };
  return { ok: true, reason: '' };
}

/** 输入框文本 → 触发词数组（逗号/顿号/分号/空白分隔，去空去重） */
export function parseKeywordsInput(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,，、;；\s]+/)) {
    const kw = raw.trim();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

export function createEntryDraft(): WbEntry {
  return {
    id: newWbId('wbe'),
    enabled: true,
    name: '',
    keywords: [],
    content: '',
    position: 'after_char',
    priority: 0,
    ignoreCase: true,
  };
}

// ---------------- 导入 / 导出 ----------------

const EXPORT_APP_TAG = 'worldbook';

interface ExportedEntry {
  enabled?: unknown;
  name?: unknown;
  keywords?: unknown;
  content?: unknown;
  position?: unknown;
  /** 旧版遗留字段：导入时忽略（范围已上移到书级） */
  scope?: unknown;
  targetContactName?: unknown;
  priority?: unknown;
  ignoreCase?: unknown;
}

interface ExportedBook {
  name?: unknown;
  enabled?: unknown;
  /** 新版：书级范围 */
  scope?: unknown;
  /** 专属书绑定的角色名字（id 跨设备无意义），导入时按当前联系人名单解析 */
  targetContactName?: unknown;
  entries?: unknown;
}

export interface WorldBookExportPayload {
  app: typeof EXPORT_APP_TAG;
  version: number;
  exportedAt: number;
  books: ExportedBook[];
}

/** 导出载荷（书级 scope + 专属绑定角色名；条目不再带范围字段） */
export function buildExportPayload(books: WorldBook[], contactNameOf: (id: string) => string): WorldBookExportPayload {
  return {
    app: EXPORT_APP_TAG,
    version: 2,
    exportedAt: Date.now(),
    books: books.map((b) => ({
      name: b.name,
      enabled: b.enabled,
      scope: b.scope,
      targetContactName: b.scope === 'exclusive' && b.targetContactId ? contactNameOf(b.targetContactId) : undefined,
      entries: b.entries.map((e) => ({
        enabled: e.enabled,
        name: e.name,
        keywords: e.keywords,
        content: e.content,
        position: e.position,
        priority: e.priority,
        ignoreCase: e.ignoreCase,
      })),
    })),
  };
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function normalizePosition(v: unknown): WbPosition {
  return isWbPosition(v) ? v : 'after_char';
}

function normalizeScope(v: unknown): WbScope {
  return isWbScope(v) ? v : 'local';
}

/**
 * 解析导入内容 → 书籍数组（专属绑定的角色名字按当前名单解析为 id，解析不到时降级为局部）。
 * 兼容形状：标准导出 {app, books:[...]} / 裸书籍数组 [...] / 单本书 {name, entries}；
 * 同时兼容 v1 旧导出（scope 在条目上）——按条目旧 scope 推断书级范围后剥离。
 * 抛错时 message 直接可展示（emoji 名字校验也在这里做）。
 */
export function parseWorldBookImport(
  parsed: unknown,
  resolveContactByName: (name: string) => string | null,
): WorldBook[] {
  let rawBooks: unknown;
  if (Array.isArray(parsed)) {
    rawBooks = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.books)) rawBooks = obj.books;
    else if (typeof obj.name === 'string') rawBooks = [parsed];
  }
  if (!Array.isArray(rawBooks) || rawBooks.length === 0) {
    throw new Error('文件里没有找到世界书（需要标准导出格式）');
  }

  const now = Date.now();
  const books: WorldBook[] = [];
  rawBooks.forEach((rb, bi) => {
    if (!rb || typeof rb !== 'object') throw new Error(`第 ${bi + 1} 本书格式不正确`);
    const b = rb as ExportedBook;
    const name = asString(b.name).trim();
    const check = wbNameCheck(name);
    if (!check.ok) throw new Error(`导入失败：${check.reason}${name ? `（${name}）` : ''}`);
    const rawEntries = Array.isArray(b.entries) ? b.entries : [];
    const entries: WbEntry[] = [];
    let legacyExclusiveTarget: string | null = null;
    let hasLegacyLocal = false;
    let hasLegacyExclusive = false;
    for (const re of rawEntries) {
      if (!re || typeof re !== 'object') continue;
      const e = re as ExportedEntry;
      const content = asString(e.content);
      const keywords = Array.isArray(e.keywords)
        ? [...new Set(e.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map((k) => k.trim()))]
        : [];
      if (!content.trim()) continue; // 没有内容的条目直接丢弃
      // v1 旧导出：记录条目级 scope 用于推断书级范围
      if (e.scope === 'exclusive') {
        hasLegacyExclusive = true;
        if (!legacyExclusiveTarget && typeof e.targetContactName === 'string' && e.targetContactName.trim()) {
          legacyExclusiveTarget = e.targetContactName.trim();
        }
      } else if (e.scope === 'local') {
        hasLegacyLocal = true;
      }
      entries.push({
        id: newWbId('wbe'),
        enabled: e.enabled !== false,
        name: asString(e.name).trim() || '未命名条目',
        keywords,
        content,
        position: normalizePosition(e.position),
        priority: Math.min(9999, Math.max(0, typeof e.priority === 'number' && Number.isFinite(e.priority) ? Math.floor(e.priority) : 0)),
        ignoreCase: e.ignoreCase !== false,
      });
    }

    // 书级范围：优先新版字段；缺失时按旧条目 scope 推断；专属绑定名解析失败 → 降级局部
    let scope = isWbScope(b.scope) ? b.scope : null;
    let targetName = asString(b.targetContactName).trim();
    if (!scope) {
      if (hasLegacyExclusive) scope = 'exclusive';
      else if (hasLegacyLocal) scope = 'local';
      else scope = entries.length > 0 ? 'global' : 'local';
      if (!targetName && legacyExclusiveTarget) targetName = legacyExclusiveTarget;
    }
    let targetContactId: string | null = null;
    if (scope === 'exclusive') {
      targetContactId = targetName ? resolveContactByName(targetName) : null;
      if (!targetContactId) scope = 'local'; // 绑定角色不存在（跨设备）：降级为局部
    }

    books.push({
      id: newWbId('wb'),
      name,
      enabled: b.enabled !== false,
      scope,
      targetContactId,
      entries,
      createdAt: now,
      updatedAt: now,
    });
  });
  if (books.length === 0) throw new Error('文件里没有可导入的条目');
  return books;
}

// ---------------- 注入格式与使用规则 ----------------

/** 世界设定包裹标记：命中的条目内容整段包在两个标记之间（AI 据此识别哪些是世界设定） */
export const WB_WRAP_OPEN = '【世界设定开始】';
export const WB_WRAP_CLOSE = '【世界设定结束】';

/**
 * 单次发送的世界书总注入预算（字符数，六个位置合计）：
 * 超出预算时按「注入顺序优先」截断——先保住 before_system/角色定义前后等 system 级内容，
 * 靠近用户消息的块最先被舍弃；书内按条目优先级保留。安全网，正常使用远达不到。
 */
export const WB_INJECT_BUDGET = 20000;

/**
 * 单条条目内容上限（字符）：一条超长 global 条目即可吃满 2 万总预算的 1/5，
 * 且超长世界设定通常是导入脏数据（正常条目几百字内）——注入侧截断护住预算。
 */
export const WB_ENTRY_MAX_CHARS = 4000;

/** 截断提示（拼在最后一个仍保留内容的位置块末尾，仅 system 可见） */
export const WB_TRUNCATE_NOTICE = '（世界设定过长：超出预算的条目已按注入顺序与优先级截断）';

/** 注入顺序（= 提示词里的物理次序）：预算截断按此顺序优先保留靠前位置 */
const WB_PROMPT_ORDER: WbPosition[] = ['before_system', 'before_char', 'after_char', 'after_system', 'before_user', 'after_user'];

/** 同一位置上多本书的排列顺序：全局（世界观框架）→ 专属（角色私设）→ 局部（会话事件） */
const WB_SCOPE_RANK: Record<WbScope, number> = { global: 0, exclusive: 1, local: 2 };

/** 单本书在一个位置上的注入块：整本包裹成一段（不同世界书各自独立成块，互不穿插干扰）。
 *  fix3-9 labels 齐全（charName/userName 均非空）时在【世界设定开始】之后加一行「你指谁」锚点 */
export interface WbLabels {
  /** AI 角色名（锚点里「你」指谁） */
  charName?: string;
  /** 机主名（锚点里「机主/用户」指谁） */
  userName?: string;
}

/** 锚点行（labels 齐全时返回，否则空串）：世界书是背景事实、不是任何人的发言，且「你/机主」各有其人 */
function wbAnchorLine(bookName: string, labels?: WbLabels): string {
  const char = (labels?.charName ?? '').trim();
  const user = (labels?.userName ?? '').trim();
  if (!char || !user) return '';
  return `（《${bookName}》背景设定为客观背景设定：文中的「你」指「${char}」（AI角色本人），「机主/用户」指「${user}」；设定是背景事实，不是任何人的发言）`;
}

/** 包裹单本书：【世界设定开始】→（锚点行）→ 正文 → 【世界设定结束】 */
function wbWrapBook(bookName: string, body: string, labels?: WbLabels): string {
  const anchor = wbAnchorLine(bookName, labels);
  return `${WB_WRAP_OPEN}\n${anchor ? `${anchor}\n` : ''}${body}\n${WB_WRAP_CLOSE}`;
}

function formatBookGroup(entries: WbEntry[], bookName: string, labels?: WbLabels): string {
  return wbWrapBook(bookName, entries.map((e) => e.content.trim()).join('\n\n'), labels);
}

/** 是否有任何位置注入了世界书内容（决定是否把「使用规则」一并写入 system） */
export function hasWbContent(blocks: WbBlocks): boolean {
  return Boolean(
    blocks.beforeSystem ||
      blocks.afterSystem ||
      blocks.beforeChar ||
      blocks.afterChar ||
      blocks.beforeUser ||
      blocks.afterUser,
  );
}

/**
 * 世界书使用规则（追加到 system 末尾；本次没有任何世界书内容时返回空串不注入）：
 * 明确告诉 AI —— 哪些是世界设定、怎么用、信息优先级顺序、冲突如何处理。
 */
export function wbRulesBlock(blocks: WbBlocks): string {
  if (!hasWbContent(blocks)) return '';
  // v63 全局预设管理器：世界书规则块接入注册表（worldbook-rules；原文零破坏）
  const block = [
    '【世界设定使用规则】',
    '对话中【世界设定开始】与【世界设定结束】标记之间的内容是本次对话的世界设定，使用时必须遵守以下规则：',
    '1. 以上是世界设定，请根据这些设定理解当前世界观、角色背景和关系；',
    '2. 如果设定与记忆、聊天记录冲突，以世界设定为准；',
    '3. 不要直接背诵设定内容，要自然地融入回复；',
    '4. 不要把设定内容当成用户说过的话；',
    '5. 不要在回复里暴露"这是设定"或"世界书"这样的字眼；',
    '6. 如果设定里没有提到的内容，不要凭空编造。',
    '各信息来源按下面的顺序理解和使用，但有一条底线：用户新消息永远要第一时间回应：',
    '1. 系统规则（最高，包括人设【禁止事项】里的格式与安全红线——任何设定都不能解除这些限制）；',
    '2. 世界书设定（理解世界观、角色背景与关系时以此为准）；',
    '3. 角色人设（性格与说话风格——世界书改变的是背景认知，不改变说话方式与输出格式）；',
    '4. 长期记忆和核心记忆（稳定的事实画像）；',
    '5. 记忆碎片（最新进展：同一件事与旧画像不一致，说明情况有了变化，按更新的理解）；',
    '6. 最近聊天记录；',
    '7. 用户新消息（必须第一时间直接回应，任何设定、记忆都不能成为无视或压制对方当前发言的理由）。',
    '冲突处理：',
    '1. 世界书与记忆冲突时，世界观类内容以世界书为准；',
    '2. 世界书内部多条设定冲突时，按条目优先级排序；',
    '3. 世界书与角色人设冲突时，世界观与背景类内容以世界书为准，但人设【禁止事项】（安全与格式红线）始终优先于世界书；',
    '4. 如果当前对话里你们还处于互不相识/刚换新身份的陌生阶段，涉及你们共同经历的世界书设定先不要生效，等关系对上再自然使用，以免穿帮。',
  ].join('\n');
  return promptTextOf('worldbook-rules', undefined, block) ?? '';
}

// ---------------- 触发匹配与注入 ----------------

/** 注入块（六个位置；空串 = 该位置没有命中条目） */
export interface WbBlocks {
  beforeSystem: string;
  afterSystem: string;
  beforeChar: string;
  afterChar: string;
  beforeUser: string;
  afterUser: string;
}

export const WB_EMPTY_BLOCKS: WbBlocks = {
  beforeSystem: '',
  afterSystem: '',
  beforeChar: '',
  afterChar: '',
  beforeUser: '',
  afterUser: '',
};

/** 扫描文本拼装：最新一条用户消息 + 最近若干条上下文（调用方传入，顺序不限） */
export function wbScanText(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join('\n');
}

/** 单条条目是否命中扫描文本（任一触发词包含即命中；空触发词永不命中） */
export function wbEntryMatches(entry: Pick<WbEntry, 'keywords' | 'ignoreCase'>, scanText: string): boolean {
  if (entry.keywords.length === 0 || !scanText) return false;
  const hay = entry.ignoreCase ? scanText.toLowerCase() : scanText;
  return entry.keywords.some((kw) => {
    const needle = entry.ignoreCase ? kw.toLowerCase() : kw;
    return needle !== '' && hay.includes(needle);
  });
}

/**
 * 收集当前聊天应注入的世界书内容（范围在书级）：
 * - 书级开关关闭 → 整本跳过；
 * - global 书：所有聊天生效，内容常驻注入（不扫描触发词）；
 * - local 书：仅当本书挂载到当前联系人时生效，条目需命中触发词；
 * - exclusive 书：仅当绑定目标 = 当前联系人时生效，条目需命中触发词；
 * 再按「条目启用 + 内容非空 + 命中」过滤，每本书按插入位置独立包裹成【世界设定开始】/【世界设定结束】块
 * （书内同位置按优先级降序；同一位置上多本书按 全局→专属→局部 排列、同范围保持书库顺序，
 *   各书独立成块互不穿插，规则互不干扰）；
 * fix3-9 可选尾参 labels（charName=角色名 / userName=机主名）：齐全时每本书包裹块头部加一行
 * 「你指谁」锚点，防 AI 把设定里的「你/机主」安错人；未传 labels 保持原样（向后兼容）。
 * 全部位置合计不超过 WB_INJECT_BUDGET 字符，超出按注入顺序截断（靠近用户消息的先舍弃）。
 * contactId 为 null（无联系人的会话）时只有 global 书可能生效。
 * 注入层任何意外异常都返回空块——世界书永不阻断消息发送。
 */
export function collectWbBlocks(contactId: string | null, scanText: string, labels?: WbLabels): WbBlocks {
  try {
    return collectWbBlocksInner(contactId, scanText, labels);
  } catch {
    return WB_EMPTY_BLOCKS;
  }
}

function collectWbBlocksInner(contactId: string | null, scanText: string, labels?: WbLabels): WbBlocks {
  const books = loadBooks();
  if (books.length === 0) return WB_EMPTY_BLOCKS;
  const bound = contactId ? new Set(getBoundBookIds(contactId)) : new Set<string>();

  // 本轮生效的书：过滤停用/未挂载/绑定他人；再按 全局→专属→局部 稳定排序（同范围保持书库顺序）
  const activeBooks = books.filter((book) => {
    if (book.enabled === false) return false;
    if (book.scope === 'local' && !bound.has(book.id)) return false;
    if (book.scope === 'exclusive' && (!contactId || book.targetContactId !== contactId)) return false;
    return true;
  });
  if (activeBooks.length === 0) return WB_EMPTY_BLOCKS;
  activeBooks.sort((a, b) => WB_SCOPE_RANK[a.scope] - WB_SCOPE_RANK[b.scope]); // Array.sort 稳定

  // 每个位置上收集「书级注入块」（已按范围顺序追加）：一本书在同一位置最多贡献一个包裹块
  // WbGroupInfo 同时承载格式化字符串与原始条目列表，截断时按条目累加，
  // 不再依赖 '\n\n' 分隔还原（条目内容本身含 '\n\n' 会被误拆成多条目）
  interface WbGroupInfo {
    formatted: string;
    entries: WbEntry[];
    /** fix3-9 书名：截断重建包裹块时锚点行需要《书名》 */
    bookName: string;
  }
  const groupsByPosition: Record<WbPosition, WbGroupInfo[]> = {
    before_system: [],
    after_system: [],
    before_char: [],
    after_char: [],
    before_user: [],
    after_user: [],
  };
  for (const book of activeBooks) {
    const alwaysInject = book.scope === 'global';
    // 本书内按位置归集命中条目（书内多条冲突 → 按条目优先级排序；不同书之间不互相穿插）
    const inBook: Partial<Record<WbPosition, WbEntry[]>> = {};
    for (const entry of book.entries) {
      if (!entry.enabled) continue;
      if (!entry.content.trim()) continue; // 空内容条目不注入（历史/导入脏数据兜底）
      if (!alwaysInject && !wbEntryMatches(entry, scanText)) continue;
      // 单条长度护栏（性能/预算保护，见 WB_ENTRY_MAX_CHARS 注释）
      const clipped = entry.content.length > WB_ENTRY_MAX_CHARS
        ? `${entry.content.slice(0, WB_ENTRY_MAX_CHARS)}…（本条世界设定超长，已截断）`
        : entry.content;
      (inBook[entry.position] ??= []).push(clipped === entry.content ? entry : { ...entry, content: clipped });
    }
    for (const pos of WB_POSITIONS) {
      const list = inBook[pos];
      if (!list || list.length === 0) continue;
      list.sort((a, b) => b.priority - a.priority); // 数字大的排前面；同优先级保持书内顺序（sort 稳定）
      const formatted = formatBookGroup(list, book.name?.trim() || '未命名世界书', labels);
      groupsByPosition[pos].push({ formatted, entries: list, bookName: book.name?.trim() || '未命名世界书' });
    }
  }

  // 按提示词物理次序填充，累计长度不超过预算；超预算的块尽量保留书内高优先级条目，后续块全部舍弃
  const keyFor = (pos: WbPosition): keyof WbBlocks =>
    pos === 'before_system' ? 'beforeSystem'
    : pos === 'after_system' ? 'afterSystem'
    : pos === 'before_char' ? 'beforeChar'
    : pos === 'after_char' ? 'afterChar'
    : pos === 'before_user' ? 'beforeUser'
    : 'afterUser';
  const blocks = { ...WB_EMPTY_BLOCKS };
  let used = 0;
  let truncated = false;
  let truncatedKey: keyof WbBlocks | null = null; // 截断发生的位置：提示独立注入到这里
  for (const pos of WB_PROMPT_ORDER) {
    const key = keyFor(pos);
    const kept: string[] = [];
    for (const group of groupsByPosition[pos]) {
      if (used + group.formatted.length <= WB_INJECT_BUDGET) {
        kept.push(group.formatted);
        used += group.formatted.length;
        continue;
      }
      // 本块放不下：保留书内排在前面的（高优先级）条目直到预算耗尽，剩余块全部舍弃；
      // 按原始 entries 逐条累加（不再依赖 '\n\n' 分隔还原，条目内容含 '\n\n' 不会被误拆）
      truncated = true;
      truncatedKey = key;
      // fix3-9 截断重建同样带锚点行（labels 齐全时），预算 accounting 计入锚点开销
      const anchor = wbAnchorLine(group.bookName, labels);
      const anchorCost = anchor ? anchor.length + 1 : 0;
      const keepEntries: string[] = [];
      let partialUsed = used + WB_WRAP_OPEN.length + WB_WRAP_CLOSE.length + 2 + anchorCost; // 包裹标记/换行/锚点开销
      for (const entry of group.entries) {
        const part = entry.content.trim();
        const add = (keepEntries.length > 0 ? 2 : 0) + part.length;
        if (partialUsed + add > WB_INJECT_BUDGET) break;
        keepEntries.push(part);
        partialUsed += add;
      }
      if (keepEntries.length > 0 && partialUsed >= used + 200) {
        kept.push(wbWrapBook(group.bookName, keepEntries.join('\n\n'), labels));
        used = partialUsed;
      }
      break;
    }
    if (kept.length > 0) {
      blocks[key] = kept.join('\n\n');
    }
    if (truncated) break;
  }
  // 截断提示独立附到截断发生的位置（truncatedKey），即便该位置 kept 为空也注入提示行，
  // 避免提示附到上一个有内容的位置块造成「提示落在错误位置」
  if (truncated && truncatedKey) {
    const existing = blocks[truncatedKey];
    blocks[truncatedKey] = existing ? `${existing}\n\n${WB_TRUNCATE_NOTICE}` : WB_TRUNCATE_NOTICE;
  }
  return blocks;
}

/**
 * 把 before_user / after_user 块包裹到消息数组最后一条 user 消息上（就地返回新数组）；
 * 没有 user 消息时原样返回。system 消息与 assistant 消息不受影响。
 */
export function applyWbUserBlocks<T extends { role: string; content: string }>(
  messages: T[],
  blocks: WbBlocks,
): T[] {
  if (!blocks.beforeUser && !blocks.afterUser) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      idx = i;
      break;
    }
  }
  if (idx < 0) return messages;
  const target = messages[idx];
  const merged = [blocks.beforeUser, target.content, blocks.afterUser].filter(Boolean).join('\n\n');
  const next = messages.slice();
  next[idx] = { ...target, content: merged };
  return next;
}
