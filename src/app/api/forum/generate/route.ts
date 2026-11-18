import { NextResponse } from 'next/server';

/**
 * X论坛 · AI 内容生成（服务端）。
 *
 * POST {
 *   config?: UpstreamConfig,             // 设置 App 的用户 API；缺省 SDK 兜底
 *   kind: 'posts' | 'reply' | 'dm' | 'comments' | 'subreplies' | 'names' | 'multiComments'
 *        | 'charPost' | 'charEngage' | 'charReply',   // v33【AI 真人社交】角色驱动三件套
 *   char?: { name, persona?, relation?, mood?, memory?, recent? },  // 角色卡（三 kind 共用：人设+情绪+记忆）
 *   userPosts?: string, events?: string[],             // charPost：用户最近帖子摘要 + 今日事件素材
 *   post?: { content, mediaDesc? },                    // charEngage：被看的用户帖子
 *   postContent?/postAuthor?/userComment?/history?/thanks?,  // charReply：神回复/点赞致谢上下文
 *   items?: { name, persona?, community?, topic?, lang? }[],  // posts：批量生成多位作者的帖子（一次最多 24 条；lang = 惯用语言）
 *   count?: number,                     // names：生成几个网名（1~30）
 *   posts?: { id, authorName, content, lang }[],       // multiComments：一批帖子各生成几条一级评论（播种期专用，一次 LLM 调用）
 *   perPost?: number,                   // multiComments：每帖几条评论（3~8）
 *   author?: { name, persona?, lang? },  // reply/dm：说话人（lang = 惯用语言）
 *   parent?: { authorName, content },   // reply：被回复的帖子/评论
 *   postContent?: string,               // reply：所在主帖内容（多轮对话上下文）
 *   mediaDesc?: string,                 // reply/comments/subreplies：帖子配图的文字描述（识图模型产出）
 *   history?: { from: 'user' | 'peer', text }[],       // dm：对话上下文；reply：评论串最近几轮
 *   post?: { authorName, content, mediaDesc? },        // comments/subreplies：被评论的主帖
 *   threads?: { authorName, content }[],               // subreplies：被回复的评论列表（逐条对应输出）
 *   personas?: { name, persona?, lang? }[],  // comments/subreplies：每条对应的评论者（与输出行一一对应；lang = 该网友惯用语言）
 *   userName?: string,                  // 机主名（称呼/被回复者）
 *   avoid?: string[],                   // 防重复：最近已出现过的内容
 * }
 * → { items: { content, textImage }[] }（posts：严格 JSON 解析后的帖子对象数组，
 *    第 N 项对应第 N 位作者，无效项 content 为空串由客户端池子兜底）；
 *   { items: string[] }（comments/subreplies/names 批量）；{ text: string }（reply/dm）
 *
 * v29（用户反馈「帖子字数都一样、没带图」）：posts 分支按用户新规范重写
 * 字数与配图两大规则。
 * - 字数池四档抽签（服务端 Math.random 等权抽档+档内点值，注入 spec 作
 *  「本次目标字数」硬指标）：极短篇 10~30（发疯/吐槽/一句话吃瓜，不强制
 *  四要素）、短篇 50~100（日常/简短吐槽）、中篇 150~300（详细吃瓜/剧情
 *  安利/长篇情感）、长篇 400~800（深度吃瓜时间线/极怒控诉）；LLM 自己
 *  “随机”会全部收敛到 200~400 中间档——正是用户抱怨的字数趋同根源；
 * - 校验层：字数（去空白含标点、剥 [图片] 占位符）必须落在四档并集
 *  （各档含 LLM 控字容差）；缝隙 31~49/101~149/301~399 与 >880 = 废稿
 *  走池子兜底（池子帖本身长短各异，不因废稿拉垮分布）；
 * - 配图规则整体替换为用户版 Image Rules：触发条件（看图/实拍/自拍/
 *  合照/打卡/偷拍/偶遇/安利/求推/OOTD → has_image 必须 true）；无图仅限
 *  纯文字吐槽/引战/无画面感搞抽象三种例外；image_description 必须极度
 *  细节、以视角开头、写清画面主体；
 * - thought 模板补「目标字数是多少」空位；retry Prompt 同步字数池+配图。
 *
 * v28（用户反馈「语境错乱」·走心帖语境适配）：文艺/深情/表白类主帖
 * （「於我而言 你比星璀璨」繁体文艺表白＋自拍）下，AI 评论曾是
 * 「救命……甜得我当场去世哈哈哈！家人们谁懂啊……笑死我了，
 * 楼主你俩锁死别出来放毒了 xswl」——楼主走心，评论发癫。
 * - 三分支（comments/multiComments/subreplies）注入「走心帖处理逻辑」：
 *   情绪识别（简短/文艺/繁体/深情文案＋自拍 → 楼主感性浪漫私密情境）
 *   ＋绝对禁令（锁死/放毒/笑死/家人们谁懂啊/xswl/当场去世一律废稿）
 *   ＋正确姿势（感动/吃狗粮/克制地酸/祝福/文艺接梗，语气沉下来同频）
 *   ＋视角降级（玩梗/暴躁/阴阳怪气在此类帖下自动失效）；
 * - 新增 isTenderPost/loudMemeIn（topic.ts）：走心帖判定（浪漫意象词＋
 *   表白句式，简繁双体）× 聒噪烂梗检测，双命中 → 服务端+客户端双保险作废；
 * - 鼓励网感的行（「笑死、xswl」等）全部追加「走心帖下一律禁用」豁免说明。
 * - 顺带修复 v27 引入的潜伏 bug：stripImgPh/IMG_PLACEHOLDER 原从 core.ts
 *   （'use client'）导入，服务端调用 stripImgPh() 抛客户端边界错误——
 *   评论三分支在 LLM 预处理前就整段崩掉（被 engine 静默吃成「还没有回复」，
 *   叠加 429 噪音极难察觉）；拆出共享模块 lib/forum/imgph.ts（无指令）。
 * v27（用户 Prompt 规范：图文并茂）posts 分支新增配图能力：
 * - 输出五字段 {thought, topic, content, has_image, image_description}：
 *   明星日常/日常分享/八卦爆料（有实锤）必配图，其余风格视内容而定；
 * - has_image=true 时 content 在最自然位置插恰好一个 [图片] 占位符，
 *   image_description 以【视角】开头（自拍/偷拍/第一人称/远景/特写），
 *   30~100 字，正文提到的物品必须在描述里出现；
 * - 图片以「纯白留白+文字居中」的文字图渲染（textimg.ts canvas 直出），
 *   textImage 字段复活＝image_description（≤110 字硬校验）；
 * - 三元校验：占位符+has_image+有效描述缺一即剥占位符防字面上屏；
 * - 评论三分支（comments/subreplies/multiComments）拼 Prompt 前统一
 *   剥掉 [图片] 占位符（防锚定词表污染与「图呢」式迷幻评论）。
 *
 * v23（用户 Prompt 规范：超级网民/八种网友风格/内部思考机制）posts 分支重写：
 * - 输出 {thought, topic, content} 三字段 JSON：thought 内部思考不上屏直接丢弃；
 *   topic 话题标签规范化成 #xx# 追加到正文尾（客户端版块归类/评论锚定依赖内嵌标签）；
 *   textImage v23 退役、v27 携 image_description 复活（图文并茂）；
 * - 字数 30~1000 → 10~1000（短帖 10~100 字精悍有梗，长帖 300~1000 剧情跌宕起伏）；
 * - 八种风格公式与示例提示对齐用户最新规范（擦边＝身体接触停留在脖颈/锁骨/指尖等）。
 *
 * v10（用户反馈「帖子太像新闻摘要，没有细节和情绪」）posts 分支 Prompt 全面重写：
 * - 八大发帖风格（八卦爆料/暴躁吐槽/追星发疯/明星日常营业/搞抽象无厘头/
 *   暧昧擦边海王风/阴暗爬行引战/日常分享），每条按加权随机分配的风格公式写，
 *   公式＋示例双锚定；
 * - 字数硬性 30~1000：服务端强校验（不足 30 字作废走池子兜底，超 1000 截断）；
 * - 真实感四要素：场景/动作/情绪/数据缺一即废——帖子必须是一件具体的事，
 *   新闻腔/总结腔词汇出现即废稿。
 *
 * v7（用户反馈「信息流结构性灾难」）posts 分支全面重构：
 * - System Prompt 严格命令模型只输出严格合法的 JSON 数组；
 * - 服务端 parseLooseJSON 解析（容忍围栏/前后杂文本），解析失败/大量无效
 *   → 严格重试一次，再失败返回全空（客户端 NPC 文案池兜底，绝不把乱稿上屏）；
 * - 字段严格隔离：content 只存帖子正文；textImage 只存文字图片短句（可选）；
 *   发帖人网名由前端根据 authorKey 独立渲染在头部，评论由另一套接口独立生成，
 *   绝不混进正文；
 * - 清洗：剥「回复 @xx：」/网名前缀、去零宽/控制字符、行首行尾拼接符 ~ |，
 *   ASCII ~ 连串折行；多人对话拼接稿（含其他作者网名+冒号，或 2 处以上
 *   「名字：」发言标记）整条作废；批内规范化去重（同名前缀剥离后同稿必撞）。
 *
 * 输出清洗：extractThinkBlocks 剥 [思考] 块；去引号/围栏/舞台指示；长度截断；
 * 时间感知注入与 moments/generate 同口径（北京时间 + 时段语境）。
 * 用户要求：帖子/评论可多语言（英/韩/日/繁体等，由网友的 lang 决定）、
 * 内容偏「编事情」的明星八卦吃瓜叙事（谁和谁怎么样、今天碰见xxx了好帅）、字数不限。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, type LLMMessage, type UpstreamConfig } from '@/lib/server-llm';
import { extractThinkBlocks } from '@/lib/think-filter';
import { commentAnchored, extractTopicWords, isBannedFiller, isFlamePost, isTenderPost, loudMemeIn, offTopicIn, personaBleedIn, postAllowsCatchall, universalPhraseIn, structuredLeakIn, isParrotReply, isScoopPost, sweetShipIn, isBenignPost, imaginaryEnemyIn, tabloidScriptIn } from '@/lib/forum/topic';
// v28：[图片] 占位符工具改从共享模块导入（无 'use client'——v27 从 core.ts
// 导入导致服务端调 stripImgPh() 抛客户端边界错误，评论三分支静默崩掉）
import { IMG_PLACEHOLDER, stripImgPh } from '@/lib/forum/imgph';
// v34 提示词面板：抽屉可查看/编辑全部生成提示词，覆盖随请求带到服务端，修改后立即生效
import { FORUM_PROMPT_DEFAULTS, fillPromptTemplate, readPromptOff, readPromptOverrides, type PromptKey } from '@/lib/forum/prompt-defs';
// 【多世界观】世界观背景/标签 + 用户自定义 AI 规则（拼接在 System Prompt 最前端，
// 最高优先级）+ 矩阵 NPC 身份渲染——engine.callApi 每次都附带，保存即生效
import { aiRulesFront, readAiRules, readWorldviewPayload, worldviewBlock } from '@/lib/forum/worldview';

/** 用户覆盖优先的 system prompt 组装（抽屉提示词面板编辑后立即生效）：
 *  未覆盖/空串 → 用默认模板（prompt-defs.ts 内与旧版逐字一致）；
 *  模板里的 {{token}} 占位符按调用现场真实值填充，用户没写的占位符保持字面。 */
function sysPrompt(
  ov: Partial<Record<PromptKey, string>> & { __off?: Set<PromptKey> },
  key: PromptKey,
  vals: Record<string, string | number>,
): string {
  // v63 全局预设管理器：条目在设置里被关闭 → 该条提示词不再注入（front 前置块不受影响）
  if (ov.__off?.has(key)) return '';
  return fillPromptTemplate(ov[key] ?? FORUM_PROMPT_DEFAULTS[key], vals);
}

/** 语言代码 → 中文名（与客户端 FORUM_LANG_LABELS 同口径） */
const LANG_LABELS: Record<string, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
};

function langLabel(lang: unknown, def = '简体中文'): string {
  return typeof lang === 'string' && LANG_LABELS[lang] ? LANG_LABELS[lang] : def;
}

function cleanText(raw: string, max: number): string {
  let t = extractThinkBlocks(raw ?? '').text;
  t = t.replace(/```(?:[\w-]+)?/gi, '').trim();
  t = t.replace(/^[「"'“”]+/, '').replace(/[」"'”"]+$/, '').trim();
  // 去掉编号前缀（批量输出时模型爱加 1. 2.）
  t = t.replace(/^\s*\d+\s*[.、)）]\s*/, '').trim();
  // 去掉开头的舞台指示；正文以 #话题 开头时除外
  if (!/^#/.test(t)) t = t.replace(/^[（(【\[][^）)】\]]{0,24}[）)】\]]/, '').trim();
  t = t.replace(/\n{2,}/g, '\n').trim();
  return t.slice(0, max);
}

/** 剥离回复对象前缀（v7 修复：评论正文绝不携带「回复 @某某：」「@某某 」字样——
 *  回复对象由前端根据真实 parentId 动态渲染；旧 prompt 让 LLM 自己写 @前缀，
 *  批量生成时行序错位会把从没出现过的人写进评论里） */
function stripReplyPrefix(raw: string): string {
  let t = raw.trim();
  // 循环处理多种写法：「回复 @xx：」「回复@xx:」「@xx 」「回复 xx：」
  for (let i = 0; i < 3; i++) {
    const next = t
      .replace(/^[回复回覆]?\s*[@＠]\S{1,24}\s*[:：，,\s]\s*/, '')
      .replace(/^回复\s*[^@\s：:，,]{1,24}\s*[:：]\s*/, '')
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

// ---------------- 评论强校验（v9：严禁串台/整句外语/乱码） ----------------

/** 繁体独有常用字（简体文本里不该成片出现） */
const TRAD_ONLY_CHARS =
  '們個這時過還發對說聽後來車馬門問長無書龍鳥語體點關應讓證邊沒壞愛國會間東兩單買賣辦動務名條當處帶幫廣歸開從優傷兒內準決覺觀視親計訊訪話該詳誤課調誰謝負財貢風飛飯飲館駐騙體魚島嶺歡樂進遠違連遲適選遜鄰醫針錢鐵銀錯鍵鎮閃閉閑閱隊階際隨隱難電霧頁頂項順頗領頻題顏願香講種樣認談論請諸諾讀讚絲喪髮為麼裡幾別嗎寫實續識編劇簡體雙嚇';
/** 对应的简体独有字（真简体评论必然带这些；整句繁体 = 繁体字成片且简体字几乎为零） */
const SIMP_ONLY_CHARS =
  '们这说过发对听后来车马门问长无书龙鸟语体点关应让证边没坏爱国会间东两单买卖办动务名条当处带帮广归开从优伤儿内准决觉观视亲计讯访话该详误课调谁谢负财贡风飞饭饮馆驻骗体鱼岛屿欢乐进远违连迟适选逊邻医针钱铁银错键镇闪闭闲阅队阶际随隐难电雾页顶项顺颇领频题颜愿香讲种样认谈论请读赞丝丧发为么里几别吗写实续识编剧简体双吓';

/** 脚本字符统计：汉字总数/拉丁字母/假名/谚文/繁体独有字/简体独有字 */
function scriptStats(text: string): { zh: number; latin: number; kana: number; hangul: number; trad: number; simp: number } {
  let zh = 0;
  let latin = 0;
  let kana = 0;
  let hangul = 0;
  let trad = 0;
  let simp = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x4e00 && c <= 0x9fff) {
      zh += 1;
      if (TRAD_ONLY_CHARS.includes(ch)) trad += 1;
      else if (SIMP_ONLY_CHARS.includes(ch)) simp += 1;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
    else if ((c >= 0x3040 && c <= 0x30ff) || c === 0x30fc) kana += 1; // 平/片假名+长音符
    else if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f)) {
      // 谚文音节按 1 计、兼容字母（ㄹㅇㅋㅋ）按 0.5 计（口癖级点缀放行）
      hangul += c >= 0xac00 ? 1 : 0.5;
    }
  }
  return { zh, latin, kana, hangul, trad, simp };
}

/** 中文帖评论语言校验：整句外语（英/日/韩/繁）→ 违规。
 *  允许「1-3 个外文字符夹杂」（www / ㅋㅋ / 草 / 太real了 这类真实点缀）。 */
function violatesCommentLang(text: string, postLang: string): boolean {
  if (postLang === 'zh-Hans') {
    const s = scriptStats(text);
    if (s.kana >= 4) return true; // 整句日语
    if (s.hangul >= 4) return true; // 整句韩语
    if (s.latin >= 10 && s.latin > s.zh * 0.8) return true; // 整句英语
    if (s.zh === 0 && s.latin + s.kana + s.hangul + s.trad >= 5) return true; // 完全无中文
    if (s.trad >= 5) return true; // 繁体字成片
    if (s.trad >= 3 && s.simp <= 1) return true; // 整句繁体（繁体独有字≥3且简体独有字几乎没有）
  }
  return false;
}

/** 常用聊天 emoji 白名单（v41 B6：真实网友会用少量 emoji；全套剥除后评论区
 *  永远打不出表情）。与客户端 engine.filterEmoji 同口径：表情脸 + 常用手势
 *  爱心火苗保留 ≤2 个，其余奇异符号照旧全剥。 */
const EMOJI_KEEP_RE = /[\u{1F600}-\u{1F64F}\u{1F44D}\u{1F44C}\u{1F44F}\u{1F64C}\u{1F91D}\u{1F4AA}\u{2764}\u{2728}\u{1F525}\u{1F4AF}\u{1F389}\u{1F38A}]/u;

/** emoji 过滤（v41 B6）：白名单常用 emoji 保留 ≤2 个，其余全剥。 */
function filterEmoji(raw: string): string {
  const cps = Array.from(raw);
  const keepIdx: number[] = [];
  cps.forEach((ch, i) => {
    if (EMOJI_KEEP_RE.test(ch)) keepIdx.push(i);
  });
  const keepSet = new Set(keepIdx.slice(0, 2)); // 只保前 2 个白名单 emoji
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const c = ch.codePointAt(0) ?? 0;
    const isEmoji =
      (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0xfe00 && c <= 0xfe0f) ||
      (c >= 0x1f1e6 && c <= 0x1f1ff) || (c >= 0x2b00 && c <= 0x2bff);
    if (!isEmoji || keepSet.has(i)) out += ch; // 非白名单 emoji 或超额：丢弃
  }
  return out;
}

/** 评论正文清洗（v9 乱码修复）：零宽/控制字符/替换符、拼接符连串、
 *  markdown 记号全清除；v41（B6）emoji 改白名单过滤（常用表情保留 ≤2 个）。 */
function sanitizeCommentText(raw: string): string {
  let t = raw;
  // 零宽字符、控制字符（保留 \n）、Unicode 替换符（乱码直接产物）
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFFFD/g, '');
  // 拼接分隔符连串（≥2 个）→ 空格
  t = t.replace(/[~～|｜·•※]{2,}/g, ' ');
  // markdown 记号
  t = t.replace(/```+/g, '').replace(/[*_`#>]{1,3}(?=\s|$)/g, '');
  // v41（B6）：emoji 白名单过滤（≤2 个常用表情，其余清除）
  t = filterEmoji(t);
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

/** 北京时间行（与 moments/generate 同口径） */
function bjTimeLine(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const period =
    hour >= 5 && hour < 8 ? '清晨'
    : hour >= 8 && hour < 11 ? '上午'
    : hour >= 11 && hour < 13 ? '中午'
    : hour >= 13 && hour < 17 ? '下午'
    : hour >= 17 && hour < 19 ? '傍晚'
    : hour >= 19 && hour < 23 ? '晚上'
    : '深夜';
  const hm = `${hour}:${String(minute).padStart(2, '0')}`;
  return `（现在是北京时间 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}，${period}——发言要符合这个时间的语境：凌晨/深夜不说「早安」，早上别说「晚安」，不要在正文里复述时间）`;
}

/** 批量拆条：模型按行输出多条时逐条校验（最短 2 字，兼容「草」「确实」类短评） */
function splitItems(raw: string, expect: number, max: number): string[] {
  const lines = raw
    .split(/\n+/)
    .map((l) => cleanText(l, max))
    .filter((l) => l.length >= 2);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const k = l.slice(0, 24);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= expect) break;
  }
  return out;
}

/** 批量生成通用重试：不足一轮后再补一次 */
async function batchWithRetry(config: UpstreamConfig | null, messages: LLMMessage[], first: string, expect: number, max: number): Promise<string[]> {
  let list = splitItems(first, expect, max);
  if (list.length < expect) {
    const raw2 = (await completeWithFallback(config, [
      ...messages,
      { role: 'assistant', content: first.slice(0, 1200) },
      { role: 'user', content: `还差 ${expect - list.length} 条，继续按同样格式补齐（只输出缺的，不要重复已输出的）` },
    ])).text;
    list = splitItems(`${list.join('\n')}\n${raw2}`, expect, max);
  }
  return list;
}

/** v22：解析评论批量输出（[{thought, comment}] JSON 数组——用户规范
 *  「先分析后生成」：thought = 内部思考（话题/情绪/角度），不上屏；
 *  comment = 最终评论。模型退化成纯字符串数组时兼容；彻底不是 JSON 时
 *  行解析兑底（splitItems 语义）。
 *  v35（用户实锤「JSON 直接渲染到前端」）：JSON.parse 失败（引号未转义/
 *  杂文本）时不再直接把原始 JSON 行当评论——先用正则逐个抠出
 *  "comment":"..." 字段值（unescape 后）再兑底，保证上屏的永远是纯文本。 */
function unescapeJsonStr(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

const COMMENT_FIELD_RE = /"comment"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function extractThoughtComments(raw: string): string[] {
  const parsed = parseLooseJSON<unknown[]>(extractThinkBlocks(raw ?? '').text);
  if (Array.isArray(parsed)) {
    const out: string[] = [];
    for (const o of parsed) {
      if (typeof o === 'string') {
        out.push(o);
        continue;
      }
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      const rec = o as Record<string, unknown>;
      if (typeof rec.comment === 'string' && rec.comment.trim()) out.push(rec.comment);
    }
    if (out.length) return out;
  }
  // v35：JSON.parse 失败（或结构不含 comment）→ 正则抠 "comment":"..." 字段值；
  // 抠出来的才是纯评论（{"thought":"...","comment":"..."} 整串绝不兑底上屏）
  const text = extractThinkBlocks(raw ?? '').text;
  const reHits: string[] = [];
  for (const m of text.matchAll(COMMENT_FIELD_RE)) {
    const v = unescapeJsonStr(m[1]).trim();
    if (v) reHits.push(v);
  }
  if (reHits.length) return reHits;
  return splitItems(raw, 30, 1000).filter((s) => !structuredLeakIn(s));
}

/** v25（用户强制要求 + 「屿哥」称呼错乱修复）：把「你现在是一个网友…」
 *  放在用户消息最开头，并带上【楼主网名】（旧版没传楼主名，模型只能从
 *  评论者名单里抓名字安到楼主头上——「屿哥」称呼错乱的直接来源）；
 *  楼主的【帖子正文】和【话题标签】原封不动嵌入（不再截断 400 字——
 *  帖子末尾的话题标签/细节往往是锚定评论的关键）。 */
function anchorHeadOf(post: { authorName?: string; content?: string; mediaDesc?: string }): string {
  const owner = typeof post.authorName === 'string' && post.authorName.trim() ? post.authorName.trim().slice(0, 24) : '楼主';
  // v27：剥掉 [图片] 占位符（防「图呢/看不到图」式迷幻评论与锚定词表污染）
  const content = typeof post.content === 'string' ? stripImgPh(post.content).slice(0, 1000) : '';
  const tags = (content.match(/#[^#\s]{1,14}#/g) ?? []).join(' ');
  const desc = typeof post.mediaDesc === 'string' && post.mediaDesc.trim() ? `（帖子配图内容：${post.mediaDesc.slice(0, 160)}）` : '';
  return (
    `你现在是一个网友，第一次刷到楼主「${owner}」发的这篇帖子：【${content}】${tags ? `（帖子话题标签：${tags}）` : ''}${desc}。` +
    `请针对这篇帖子的具体内容发表评论；称呼发帖人只能用「楼主」或直接针对 TA 的事说。` +
    `如果评论内容与帖子无关，生成将直接失败。`
  );
}

// ---------------- posts 分支：严格 JSON 解析 + 校验清洗（v7 结构性灾难修复） ----------------

interface PostGenItem {
  /** 帖子正文（清洗后；无效/作废为空串——客户端按空位用文案池兜底）。
   *  v27：配图帖正文含恰好一个 [图片] 占位符（渲染端分段上屏） */
  content: string;
  /** v27 复活：has_image 帖的图片描述（≤110字，以【视角】开头）——客户端
   *  canvas 渲染成纯白底居中文字图（与发布弹层「文字图片」同款观感） */
  textImage: string;
}

/** 正则转义（网名里可能有特殊字符） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 「名字：」式发言标记（行首/空白/拼接符后的 词+全半角冒号；冒号后不要求空格——
 *  中文「我：」「你：」后直接接正文是常态；名字段须含至少一个非数字字符——
 *  排除 08:26 时间、1:2 比例这类误报）：≥2 处 = 多人对话拼接稿 */
const SPEAKER_RE =
  /(?:^|\n|\s|[~～|｜])[@＠]?(?=[^\s:：，。！!？?~～|｜]{1,24}[:：])(?=[^\s:：，。！!？?~～|｜]*[^\s:：，。！!？?~～|｜\d])[^\s:：，。！!？?~～|｜]{1,24}[:：]/g;

/** 帖子正文清洗 + 灾难稿检测。
 *  返回 null = 整条作废（多人拼接/混入他人评论），客户端会用文案池补位。
 *  ownName = 该帖作者网名；allNames = 本批全部作者网名（含自己）。 */
function sanitizePostContent(raw: string, ownName: string, allNames: string[]): string | null {
  // v10 字数硬上限 1000（用户要求帖子 30~1000 字）；剥思考块/围栏/引号/编号前缀/舞台指示
  let t = cleanText(raw, 1000);
  t = stripReplyPrefix(t); // 剥「回复 @xx：」式前缀
  // 清除零宽字符与控制字符（保留 \n）——「奇怪的拼接符导致解析失败」的元凶之一
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // ASCII ~ 连串 = 大模型把多人发言糊一条时爱用的分隔符：折成换行再逐行清洗行首行尾拼接符
  t = t.replace(/~+/g, '\n');
  t = t
    .split('\n')
    .map((l) => l.replace(/^[~～|｜·•\s]+/, '').replace(/\s*[~～|｜]+$/, '').trim())
    .filter(Boolean)
    .join('\n');
  // 剥开头网名前缀：「草莓大福今天吃了吗：正文」——发帖人名字由系统独立展示在头部，
  // 出现在正文开头的任何本批网名都是模型写串了，剥掉名字与后面的冒号
  for (const n of allNames) {
    if (n && t.startsWith(n)) {
      const rest = t.slice(n.length).replace(/^[\s:：~～\-—]+/, '').trim();
      if (rest.length >= 4) t = rest;
      break;
    }
  }
  // 「@名 正文」形态（顶帖一般不会以 @ 开头，模型写串的句柄前缀）
  if (/^[@＠][^\s:：]{1,24}\s+/.test(t)) {
    const rest = t.replace(/^[@＠][^\s:：]{1,24}\s+/, '');
    if (rest.length >= 4) t = rest;
  }
  // 灾难稿检测①：正文里混入其他作者的网名 + 冒号（把别人的评论拼进来了）→ 整条作废
  for (const n of allNames) {
    if (!n || n === ownName) continue;
    if (new RegExp(`(?:^|[\\n\\s~～|｜@＠])${escapeRe(n)}\\s*[:：]`).test(t)) return null;
  }
  // 灾难稿检测②：2 处以上「名字：」式发言标记 = 多人轮流发言的聊天记录稿 → 整条作废
  if ((t.match(SPEAKER_RE) ?? []).length >= 2) return null;
  // v23 字数铁律（用户规范 10~1000 字）：去空白后不足 10 字 = 废稿（短帖 10~100 字精悍有梗）
  if (t.replace(/\s+/g, '').length < 10) return null;
  // v35：JSON 残留 / 指令泄露（正文把 {"thought":…} 或【本帖核心话题词…】当内容）→ 整条作废
  if (structuredLeakIn(t)) return null;
  return t;
}

// ---------------- posts 分支：八大发帖风格（v10 Prompt 重写） ----------------

/** 八大发帖风格（v10 用户指定；v23 公式对齐用户最新 Prompt 规范）。
 *  weight = 随机分配权重：日常分享/暴躁吐槽是信息流大头，明星本尊/擦边/阴暗爬行少而精。 */
const POST_STYLES: { id: string; label: string; spec: string; weight: number }[] = [
  {
    id: 'bagua',
    label: '八卦爆料',
    spec: '具体地点＋偷窥视角动作＋明星特征＋明显的名字或代号或缩写＋震惊情绪，细节拉满带「偷感」（话题写进 topic 字段）',
    weight: 15,
  },
  {
    id: 'baozao',
    label: '暴躁吐槽',
    spec: '具体事件＋离谱细节（数据/动作）＋破防脏话（用拼音或谐音：卧槽/绝了/tmd）＋强烈建议',
    weight: 18,
  },
  {
    id: 'fengkuang',
    label: '追星发疯',
    spec: '绝美物料出处＋致命细节（动作/表情/穿搭）＋疯狂尖叫＋发疯言论（谁懂啊/我人没了/救命），饭圈黑话感叹号管够',
    weight: 12,
  },
  {
    id: 'mingxing',
    label: '明星日常（假装本尊）',
    spec: '只讲今天发生的一件小事——收工买咖啡被店员记住/一场雨戏淋六小时/亲自澄清一条谣言/就新剧更新说两句，选其一讲透；严禁把剧宣＋澄清＋求互动＋代言塞进同一条，结尾最多自然带一句自拍描述',
    weight: 8,
  },
  {
    id: 'chouxiang',
    label: '搞抽象/无厘头',
    spec: '前言不搭后语＋离谱的比喻＋烂梗，毫无逻辑纯发疯',
    weight: 12,
  },
  {
    id: 'meimei',
    label: '擦边性暗示（高端海王风）',
    spec: '暧昧场景＋身体接触描写（停留在脖颈/锁骨/指尖）＋欲言又止的省略号，话不说透但引人遐想，克制高级绝不露骨',
    weight: 8,
  },
  {
    id: 'yinying',
    label: '阴暗爬行（引战/三观炸裂）',
    spec: '极度自私的诉求＋扭曲的三观＋绿茶/白莲花发言（我不是坏心/我只是觉得），写得理直气壮让人极度不适',
    weight: 7,
  },
  {
    id: 'richang',
    label: '日常分享',
    spec: '天气/气味＋味觉/视觉感官细节＋和对象/家人的合影或自拍描述＋一种情绪打底（暗恋/表白/难过/吐槽任选）',
    weight: 20,
  },
];

/** 解析客户端指定的风格（按 id 或 label；无效返回 undefined → 加权随机） */
function findPostStyle(s: string): (typeof POST_STYLES)[number] | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return undefined;
  return POST_STYLES.find(
    (x) => x.id === t || x.label === s.trim() || x.label.startsWith(s.trim()),
  );
}

/** 加权随机抽一个风格 */
function pickPostStyle(): (typeof POST_STYLES)[number] {
  const total = POST_STYLES.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const st of POST_STYLES) {
    r -= st.weight;
    if (r < 0) return st;
  }
  return POST_STYLES[POST_STYLES.length - 1];
}

// ---------------- v29 字数池（用户规范：字数绝对随机，四档抽签严格执行） ----------------

/** 四档字数池（用户规范原文）：每次生成前随机选一档，作为「本次目标字数」
 *  硬指标注入 spec——服务端 Math.random 抽签（LLM 自己“随机”会全部收敛到
 *  中间档 200~400，正是用户抱怨「字数都一样」的根源）。
 *  hint 用于 spec 行内提示该档适配的内容形态。 */
const POST_LEN_PLANS: { id: string; label: string; min: number; max: number; hint: string }[] = [
  { id: 'tiny', label: '极短篇', min: 10, max: 30, hint: '没头没尾一句话，越短越狠' },
  { id: 'short', label: '短篇', min: 50, max: 100, hint: '一两件事说完就收，不注水' },
  { id: 'mid', label: '中篇', min: 150, max: 300, hint: '细节拉满，情绪有起伏' },
  { id: 'long', label: '长篇', min: 400, max: 800, hint: '时间线式层层递进，让人看得下去' },
];

/** v29 抽一个字数档（等权四选一）+ 档内随机目标点值。
 *  target 写进 spec「目标约 N 字」——点值比区间好执行，帮 LLM 收敛。 */
function pickLenPlan(): { plan: (typeof POST_LEN_PLANS)[number]; target: number } {
  const plan = POST_LEN_PLANS[Math.floor(Math.random() * POST_LEN_PLANS.length)];
  const target = plan.min + Math.floor(Math.random() * (plan.max - plan.min + 1));
  return { plan, target };
}

/** v29 字数池校验区间（四档并集，各档含 LLM 控字偏差容差；
 *  档位间隙 31~49 / 101~149 / 301~399 与 >880 不属于任何档 = 废稿）。 */
const LEN_BUCKETS: [number, number][] = [
  [10, 38], // 极短篇 10~30（容差 +8）
  [45, 112], // 短篇 50~100（容差 -5/+12）
  [142, 318], // 中篇 150~300（容差 -8/+18）
  [392, 880], // 长篇 400~800（容差 -8/+80）
];

/** 字数口径（与 Prompt 一致）：去空白、含标点、剥 [图片] 占位符。 */
function postLen(text: string): number {
  return text.split(IMG_PLACEHOLDER).join('').replace(/\s+/g, '').length;
}

/** v29：字数必须落在四档并集内（缝隙/超880/不足10 = 废稿走池子兜底）。 */
function lenBucketOk(n: number): boolean {
  return LEN_BUCKETS.some(([lo, hi]) => n >= lo && n <= hi);
}

/** 从模型回复中提取严格 JSON 帖子数组（容忍 ``` 围栏与前后杂文本；非数组/解析失败返回 []）。
 *  v23：模型按用户规范输出 {thought, topic, content} 三字段——thought 是内部
 *  思考不上屏直接丢弃；topic 是话题标签（alignPostItems 里规范化后追加进正文）。
 *  v27：新增 has_image/image_description 两字段（图文并茂配图）。 */
function extractPostItems(raw: string): { content: string; topic: string; hasImage: boolean; imageDesc: string }[] {
  const text = extractThinkBlocks(raw ?? '').text;
  const parsed = parseLooseJSON<unknown>(text);
  const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  return arr.map((o) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const rec = o as Record<string, unknown>;
      return {
        content: typeof rec.content === 'string' ? rec.content : '',
        topic: typeof rec.topic === 'string' ? rec.topic.trim().slice(0, 30) : '',
        hasImage: rec.has_image === true,
        imageDesc: typeof rec.image_description === 'string' ? rec.image_description.trim().slice(0, 110) : '',
      };
    }
    return { content: '', topic: '', hasImage: false, imageDesc: '' };
  });
}

/** v23：topic 字段规范化成 #xx# 追加到正文尾——客户端版块归类、评论锚定、
 *  话题高亮全部依赖正文内嵌标签（#[^#\s]{1,14}# 口径，故截 14 字）；
 *  正文已含同款标签时不重复追加。 */
function normalizeTopicTag(raw: string, content: string): string {
  const t = (raw.split(/[#\s]+/).filter(Boolean)[0] ?? '').slice(0, 14);
  if (t.length < 2) return '';
  if (content.includes(`#${t}#`)) return '';
  return `#${t}#`;
}

/** 解析结果 → 与作者一一对齐的清洗后数组（第 i 项对应第 i 位作者；
 *  无效项置空串；批内规范化去重——前缀剥离后同稿必撞。
 *  v23：LLM 的 topic 字段规范化成 #xx# 追加到正文尾（同款标签已在正文则不重复）；
 *  v27：配图三元校验（占位符+has_image+有效描述）——齐备才保留图与占位符，
 *  否则剥掉正文中所有 [图片] 字样（防字面占位符上屏） */
function alignPostItems(
  parsed: { content: string; topic: string; hasImage: boolean; imageDesc: string }[],
  expect: number,
  allNames: string[],
  seenFp: Set<string>,
): PostGenItem[] {
  const out: PostGenItem[] = [];
  for (let i = 0; i < expect; i++) {
    const ownName = allNames[i] ?? '';
    const raw = parsed[i]?.content ?? '';
    const content = raw ? sanitizePostContent(raw, ownName, allNames) : null;
    if (!content) {
      out.push({ content: '', textImage: '' });
      continue;
    }
    // v27 配图三元校验：占位符 + has_image + 有效描述（4~110 字）三者齐备才配图
    const desc = (parsed[i]?.imageDesc ?? '').trim();
    const hasPh = content.includes(IMG_PLACEHOLDER);
    const imgOk = !!(parsed[i]?.hasImage && hasPh && desc.length >= 4 && desc.length <= 110);
    let body = content;
    if (hasPh) {
      // 恰好保留一个占位符（多余的剥掉）；无图时全剥（防字面 [图片] 上屏）
      const parts = content.split(IMG_PLACEHOLDER);
      body = (imgOk ? parts[0] + IMG_PLACEHOLDER + parts.slice(1).join('') : parts.join(''))
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    }
    // v29 字数池校验：字数（去空白含标点、剥 [图片] 占位符）必须落在四档并集内
    // ——缝隙（31~49/101~149/301~399/超880/不足10）不属于任何档 = 废稿走池子兜底
    if (!lenBucketOk(postLen(body))) {
      out.push({ content: '', textImage: '' });
      continue;
    }
    // 批内规范化去重（去空白后前 30 字指纹；同稿不同前缀也会在这里撞上）
    const fp = body.replace(/\s+/g, '').slice(0, 30);
    if (seenFp.has(fp)) {
      out.push({ content: '', textImage: '' });
      continue;
    }
    seenFp.add(fp);
    // v23：topic 话题标签规范化成 #xx# 追加到正文尾（客户端版块归类/评论锚定依赖内嵌标签）
    const tag = normalizeTopicTag(parsed[i]?.topic ?? '', body);
    out.push({ content: tag ? `${body} ${tag}` : body, textImage: imgOk ? desc : '' });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const config = extractUpstreamConfig(body.config);
    // v35（用户反馈「太发散、太发癫」）：上游温度钳制 ≤ 0.7——配置了高温 API
    // 的用户也按「贴着帖子说话」的档位出稿（SDK 兜底路径已在 server-llm 固定 0.65）
    if (config && config.temperature > 0.7) config.temperature = 0.7;
    const kind = typeof body.kind === 'string' ? body.kind : '';
    // v34 提示词面板：客户端随请求送来的提示词覆盖（未知 key 忽略；空串视为未覆盖）
    const promptOv = Object.assign(readPromptOverrides(body.prompts), {
      // v63：全局预设管理器关闭的论坛条目（engine 每次随请求上送）
      __off: readPromptOff(body.promptOff),
    });
    // 【多世界观】世界观背景 + 用户自定义 AI 规则：规则块拼在 System Prompt 最前端
    //（最高优先级，凌驾于模板之上），世界观背景紧随其后——所有内容生成分支
    //（names 起名除外）共用；两块都为空时零开销（经典模式完全不变）
    const wvP = readWorldviewPayload(body.worldview);
    const aiRules = readAiRules(body.aiRules);
    const front = kind === 'names' ? '' : aiRulesFront(aiRules, kind) + worldviewBlock(wvP);
    const userName = typeof body.userName === 'string' ? body.userName.slice(0, 20) : '你';
    const avoid = Array.isArray(body.avoid)
      ? body.avoid.filter((x): x is string => typeof x === 'string').slice(0, 12)
      : [];
    const avoidLine = avoid.length
      ? `\n\n这些内容最近已经出现过，不要重复、也不要撞车：\n${avoid.map((a) => `- ${a.slice(0, 60)}`).join('\n')}`
      : '';

    if (kind === 'posts') {
      const items = Array.isArray(body.items)
        ? (body.items as Record<string, unknown>[])
            .slice(0, 24)
            .map((it) => ({
              name: typeof it.name === 'string' ? it.name.slice(0, 24) : '网友',
              // 【多世界观】矩阵 NPC 的合并人设（身份+性格+口头禅）更长，放宽截断
              persona: typeof it.persona === 'string' ? it.persona.slice(0, it.matrix === true ? 360 : 300) : '',
              community: typeof it.community === 'string' ? it.community.slice(0, 16) : '今日热议',
              topic: typeof it.topic === 'string' ? it.topic.slice(0, 16) : '',
              lang: typeof it.lang === 'string' ? it.lang : 'zh-Hans',
              style: typeof it.style === 'string' ? it.style.slice(0, 24) : '',
              matrix: it.matrix === true,
              recent: Array.isArray(it.recent)
                ? (it.recent as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3)
                : [],
            }))
            .filter((it) => it.persona || it.name)
        : [];
      if (!items.length) return NextResponse.json({ error: 'items 为空' }, { status: 400 });
      const expect = items.length;
      const allNames = items.map((it) => it.name);
      const spec = items
        .map((it, i) => {
          const mem = it.recent.length
            ? `；TA最近发过：${it.recent.map((r) => `「${r.slice(0, 40)}」`).join('、')}——这次可以接上之前的话茬（比如上次抱怨没买、这次晒到手；上次说瓜没意思、这次说看吧我早说了）`
            : '';
          // v10：风格分配（客户端指定优先，缺省加权随机）；同一批内尽量不重样
          // v29：字数档独立等权抽签+档内点值——服务端随机保证字数分布差距极大
          const st = findPostStyle(it.style) ?? pickPostStyle();
          const { plan: lp, target } = pickLenPlan();
          // 【多世界观】矩阵 NPC：身份人设必须完全代入（瓜主/营销号/站姐/杠精的鲜明
          // 身份是刻意设计）；普通网友仍走普通人设渲染
          const personaHead = it.matrix
            ? `身份人设·必须完全代入这个身份、性格与口头禅发帖：${it.persona}`
            : `人设：${it.persona || '普通论坛网友'}`;
          return `${i + 1}. ${it.name}（${personaHead}；本次发帖风格：【${st.label}】公式＝${st.spec}；本次目标字数：【${lp.label}】${lp.min}~${lp.max} 字（目标约 ${target} 字，${lp.hint}）；主题方向：${it.topic || '娱乐热点'}；发帖语言：${langLabel(it.lang)}；发在「${it.community}」版块${mem}）`;
        })
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            // v34 提示词面板：默认模板已搬到 lib/forum/prompt-defs.ts（抽屉可查看/编辑，立即生效）
            // 【多世界观】front = 用户规则（最前端）+ 世界观背景，拼接在模板前
            front + sysPrompt(promptOv, 'posts', { expect }),
        },
        {
          role: 'user',
          content: `请为下面 ${expect} 位论坛网友各写一条帖子（每条严格按分配的「发帖风格」公式写；字数严格执行分配的「本次目标字数」档位——去空白含标点落在该档区间内；短篇起四要素齐备，极短篇只要一句话+情绪；先在 thought 里完成内部思考，再起 topic 话题标签，然后写 content 正文，最后按配图规则定 has_image 与 image_description——需要配图的帖在正文最自然的位置插一个 [图片] 占位符）：输出恰好 ${expect} 个对象的 JSON 数组（第 N 个对象对应第 N 位网友，顺序一致）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const seenFp = new Set<string>();
      let list = alignPostItems(extractPostItems(raw), expect, allNames, seenFp);
      // 有效条数不足一半：多半是模型没按 JSON 输出或大量废稿 → 严格重试一次
      const validN = (l: PostGenItem[]) => l.filter((x) => x.content).length;
      if (validN(list) < Math.ceil(expect / 2)) {
        try {
          const raw2 = (
            await completeWithFallback(config, [
              ...messages,
              { role: 'assistant', content: raw.slice(0, 1500) },
              {
                role: 'user',
                content: `你上一次的输出不是合法的 JSON 数组（或大量对象无效）。重新输出：恰好 ${expect} 个对象、只含 thought/topic/content/has_image/image_description 五个字段的 JSON 数组，除 JSON 本身外禁止任何文字，不要代码围栏。再次提醒：content 里不能出现任何人的网名或名字，不能把别人的评论混进正文；每条字数严格执行分配的字数档（极短篇10~30/短篇50~100/中篇150~300/长篇400~800，去空白含标点，绝不落在 31~49/101~149/301~399 缝隙或超 880，极短篇不强制四要素），严格按分配的发帖风格公式写，topic 贴着内容起；配图规则：提到看图/实拍/自拍/合照/打卡/偷拍/偶遇/安利/求推/OOTD 的帖 has_image 必须为 true 且 content 里插恰好一个 [图片] 占位符，image_description 以视角开头、极度细节 30~100 字；只有纯文字吐槽/引战/无画面感搞抽象才允许 has_image=false（content 里绝不出现 [图片] 字样且 image_description 为空串）。`,
              },
            ])
          ).text;
          const retry = alignPostItems(extractPostItems(raw2), expect, allNames, new Set());
          if (validN(retry) > validN(list)) list = retry;
        } catch {
          /* 重试失败：按现有结果返回，客户端文案池兜底 */
        }
      }
      return NextResponse.json({ items: list });
    }

    if (kind === 'names') {
      // LLM 生成真实感网名（用户要求：网名不要内置池子，让 AI 起名；
      // v5：网名与帖子/兴趣领域彻底解绑——真实网名和这人爱聊什么毫无关系）。
      // count = 需要几个；avoid = 已用网名（防撞）。
      const count = Math.min(Math.max(Math.floor(Number(body.count) || 0), 1), 30);
      const avoidNames = Array.isArray(body.avoid)
        ? body.avoid.filter((x): x is string => typeof x === 'string').slice(-60)
        : [];
      const avoidLine = avoidNames.length
        ? `\n\n这些网名已经有人用了，不要重复、也不要高度相似：\n${avoidNames.map((a) => a.slice(0, 20)).join('、')}`
        : '';
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            sysPrompt(promptOv, 'names', {}),
        },
        { role: 'user', content: `请生成 ${count} 个网名，每行一个（输出 ${count} 行）。${avoidLine}` },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = splitItems(raw, count, 24)
        .map((n) => n.replace(/^@/, '').trim())
        .filter((n) => n.length >= 2 && n.length <= 16);
      // v41（C4）：不足额补试一次（模型数错行/被截断时不再直接短斤缺两）
      if (list.length < count) {
        try {
          const raw2 = (
            await completeWithFallback(config, [
              ...messages,
              { role: 'assistant', content: raw.slice(0, 1200) },
              { role: 'user', content: `还差 ${count - list.length} 个网名，继续按同样格式补齐（只输出缺的，每行一个，不要重复已输出的）` },
            ])
          ).text;
          const seen = new Set(list);
          for (const n of splitItems(raw2, count - list.length, 24)
            .map((x) => x.replace(/^@/, '').trim())
            .filter((x) => x.length >= 2 && x.length <= 16)) {
            if (list.length >= count) break;
            if (!seen.has(n)) {
              seen.add(n);
              list.push(n);
            }
          }
        } catch {
          /* 补试失败：按现有结果返回（客户端用池子名兑底） */
        }
      }
      return NextResponse.json({ items: list });
    }

    if (kind === 'multiComments') {
      // v15 新增：一批帖子各生成几条一级评论（播种期用——旧版首刷评论从写死的
      // 主题池随机抽，是「应援色帖下考研/图书馆/代拍评论」串台的根源；现在
      // 改为一次 LLM 调用按每条帖子的具体内容实时生成）。
      // POST { posts: [{ id, authorName, content, lang }], perPost } → { items: [{ postId, comments[] }] }
      const posts = Array.isArray(body.posts)
        ? (body.posts as Record<string, unknown>[])
            .slice(0, 16)
            .map((p) => ({
              id: typeof p.id === 'string' ? p.id.slice(0, 32) : '',
              authorName: typeof p.authorName === 'string' ? p.authorName.slice(0, 24) : '有人',
              // v27：剥 [图片] 占位符（锚定词表/引战检测/话题词提取统一用干净正文）
              content: typeof p.content === 'string' ? stripImgPh(p.content).slice(0, 1000) : '',
              lang: typeof p.lang === 'string' && LANG_LABELS[p.lang] ? p.lang : 'zh-Hans',
            }))
            .filter((p) => p.id && p.content)
        : [];
      const perPost = Math.min(Math.max(Math.floor(Number(body.perPost) || 5), 3), 8);
      if (!posts.length) return NextResponse.json({ error: 'posts 为空' }, { status: 400 });
      const spec = posts
        .map((p, i) => {
          const tags = (p.content.match(/#[^#\s]{1,14}#/g) ?? []).join(' ');
          const tw = extractTopicWords(p.content);
          // v25：引战/三观争议帖逐帖标注（评论区骂声一片，不许顺着楼主说话）
          const flame = isFlamePost(p.content) ? '｜【引战/三观争议帖：至少一半评论直接批评楼主，绝不顺着 TA 说话】' : '';
          // v28：走心帖（文艺/深情/表白）逐帖标注——语气沉下来同频，严禁聒噪烂梗
          const tender = isTenderPost(p.content) ? '｜【走心帖：楼主在走心，语气沉下来同频，严禁锁死/放毒/笑死/xswl 式聒噪烂梗】' : '';
          // v35：吃瓜爆料帖逐帖标注——求锤/猜身份/蹲后续为主，磕糖甜评最多 1 条
          const scoop = isScoopPost(p.content) && !isTenderPost(p.content)
            ? '｜【吃瓜爆料帖：至少一半评论是求图求锤/猜当事人身份/震惊蹲后续/粉丝心态（要塌了/快跑）；磕糖甜评（好甜/好稳/锁死/好配）最多 1 条】'
            : '';
          // v44【防杠精安全锁】：善意短帖（夸奖/晚安/自拍类）逐帖标注——评论区必须
          // 同样友好（「你很可爱」换来「纯纯P图」= 杠精发癫，直接废稿）
          const benign = isBenignPost(p.content)
            ? '｜【善意短帖：楼主情绪友好无争议点，评论必须同样友好（夸回去/接梗/温和提问）；严禁攻击、阴阳怪气、P图指控，严禁脑补「有人骂楼主/公道话」这类帖里不存在的剧情】'
            : '';
          return (
            `${i + 1}. postId=${p.id}｜楼主${p.authorName}发的帖子：【${p.content}】` +
            `${tags ? `（话题标签：${tags}）` : ''}${tw.length ? `｜核心话题词：${tw.join('、')}` : ''}${flame}${tender}${scoop}${benign}`
          );
        })
        .join('\n\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            front + sysPrompt(promptOv, 'multiComments', { postCount: posts.length, perPost }),
        },
        {
          role: 'user',
          content: `你现在是一个网友，正在逐条看这些帖子并分别评论。请针对每篇帖子的具体内容发表评论——评论内容与帖子无关，生成将直接失败；称呼发帖人只能用「楼主」。\n\n帖子列表：\n${spec}\n\n请按系统指令输出 JSON 数组（每个 postId 各 ${perPost} 条评论；thought 先完成分析，不上屏）。${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const byId = new Map(posts.map((p) => [p.id, p]));
      // v40：解析+校验链抽成函数（重试复用）——非法 JSON / postId 对不上时按空评论返回
      const collect = (src: string): { postId: string; comments: string[] }[] => {
        const parsed = parseLooseJSON<unknown[]>(extractThinkBlocks(src ?? '').text);
        const out = posts.map((p) => ({ postId: p.id, comments: [] as string[] }));
        if (Array.isArray(parsed)) {
        for (const o of parsed) {
          if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
          const rec = o as Record<string, unknown>;
          const pid = typeof rec.postId === 'string' ? rec.postId : '';
          const post = byId.get(pid);
          const target = out.find((x) => x.postId === pid);
          if (!post || !target) continue;
          const arr = Array.isArray(rec.comments) ? rec.comments : [];
          const seen = new Set(target.comments.map((c) => c.slice(0, 16)));
          // v22：万能句式豁免（未完结八卦/求助帖）且每帖限 1 条
          const catchallOk = postAllowsCatchall(post.content);
          let catchallUsed = false;
          // v35：吃瓜爆料帖磕糖甜评限 1 条
          const scoopPost = isScoopPost(post.content) && !isTenderPost(post.content);
          let sweetUsed = false;
          // v44【防杠精安全锁】：善意短帖下的虚空索敌/无端攻击评论 → 作废
          const benignPost = isBenignPost(post.content);
          for (const c of arr) {
            if (typeof c !== 'string') continue;
            const s = sanitizeCommentText(stripReplyPrefix(c));
            // 用户规范：评论 3~100 字（留 10 字容差）
            if (s.length < 3 || s.length > 110 || seen.has(s.slice(0, 16))) continue;
            if (violatesCommentLang(s, post.lang)) continue;
            // v35 第一道闸：JSON 残留 / 系统指令泄露 → 作废
            if (structuredLeakIn(s)) continue;
            // v22 万能句式：非豁免帖全废；豁免帖限 1 条
            if (universalPhraseIn(s)) {
              if (!catchallOk || catchallUsed) continue;
              catchallUsed = true;
            }
            // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱评论作废
            if (isTenderPost(post.content) && loudMemeIn(s)) continue;
            // v44 防杠精：善意短帖 + 虚空索敌/无端攻击（公道话/被骂/P图指控）→ 作废
            if (benignPost && imaginaryEnemyIn(s)) continue;
            // v45 拿错剧本：善意/走心帖 + 狗仔预告式身份模板（明天十点开团/L姓顶流/
            // 懂的都懂）→ 矩阵 NPC 机械降神作废（「懂瓜呱」病例）
            if ((benignPost || isTenderPost(post.content)) && tabloidScriptIn(s)) continue;
            // v35 爆料帖：磕糖甜评超 1 条 → 作废
            if (scoopPost && sweetShipIn(s)) {
              if (sweetUsed) continue;
              sweetUsed = true;
            }
            // v25 领域私货：评论携带 ≥2 个该帖领域之外的关键词 → 串台作废
            if (offTopicIn(s, post.content)) continue;
            if (!commentAnchored(s, post.content)) continue;
            seen.add(s.slice(0, 16));
            target.comments.push(s);
            if (target.comments.length >= perPost) break;
          }
        }
        }
        return out;
      };
      let out = collect(raw);
      // v40：整批有效评论不足半数（JSON 解析失败/大量废稿）→ 严格重试一次（与 posts/comments 同口径）
      const totalOf = (o: { comments: string[] }[]) => o.reduce((n, x) => n + x.comments.length, 0);
      if (totalOf(out) < Math.ceil((posts.length * perPost) / 2)) {
        try {
          const raw2 = (
            await completeWithFallback(config, [
              ...messages,
              { role: 'assistant', content: raw.slice(0, 1500) },
              {
                role: 'user',
                content: `你上一次的输出不是合法的 JSON 数组（或大量评论无效被过滤）。重新输出：恰好 ${posts.length} 个对象、每个只含 postId 和 comments（每帖 ${perPost} 条 3~100 字评论）的 JSON 数组，postId 必须与输入列表完全相同，除 JSON 本身外禁止任何文字，不要代码围栏。`,
              },
            ])
          ).text;
          const retry = collect(raw2);
          if (totalOf(retry) > totalOf(out)) out = retry;
        } catch {
          /* 重试失败：按现有结果返回（客户端宁缺毋滥） */
        }
      }
      return NextResponse.json({ items: out });
    }

    if (kind === 'comments' || kind === 'subreplies') {
      const post = body.post as { authorName?: string; content?: string; mediaDesc?: string; lang?: string } | undefined;
      // 帖子语言（v9：评论语言必须跟随帖子语言——中文帖全中文，外语帖才允许外语评论）
      const postLangRaw = typeof post?.lang === 'string' ? post.lang : '';
      const postLang = LANG_LABELS[postLangRaw] ? postLangRaw : 'zh-Hans';
      const personas = Array.isArray(body.personas)
        ? (body.personas as Record<string, unknown>[])
            .slice(0, 30)
            .map((p) => ({
              name: typeof p.name === 'string' ? p.name.slice(0, 24) : '网友',
              // 【多世界观】矩阵 NPC 身份人设（身份+性格+口头禅）更长，放宽截断
              persona: typeof p.persona === 'string' ? p.persona.slice(0, p.matrix === true ? 340 : 200) : '普通论坛网友',
              lang: typeof p.lang === 'string' ? p.lang : 'zh-Hans',
              matrix: p.matrix === true,
              // v43【NPC 记忆】：这位网友在楼主帖下留过的言（客户端拼好的单行；缺省 = 无史不注入）
              npcHistory: typeof p.npcHistory === 'string' ? p.npcHistory.slice(0, 260) : '',
            }))
        : [];
      if (!post || !personas.length) return NextResponse.json({ error: '参数为空' }, { status: 400 });
      // v14 核心话题词（用户要求：生成评论前必须先提取；每条评论必须包含或呼应）
      const postContentRaw = typeof post.content === 'string' ? stripImgPh(post.content) : '';
      const topicWords = extractTopicWords(postContentRaw);
      const topicLine = topicWords.length
        ? `\n【本帖核心话题词（每条评论至少呼应其一，帖里没提的领域一个字不许出现）】${topicWords.join('、')}`
        : '';

      if (kind === 'comments') {
        const expect = personas.length;
        // v25：引战/三观争议帖 → 评论区风向指令（真实互联网上这种楼主一定被骂上热评）
        const flame = isFlamePost(postContentRaw);
        const flameLine = flame
          ? '\n\n【本帖判定：引战/三观争议帖】真实互联网上，这种楼主评论区一定骂声一片：本批至少一半评论要直接批评楼主（暴躁开喷/阴阳怪气/义正词严怒斥都行），绝不许全员温和理智分析，更不许顺着楼主说话、帮楼主找补。骂要骂在点子上（针对楼主的具体行为），不是无脑输出。'
          : '';
        // v28：走心帖（文艺/深情/表白）→ 语气同频指令（楼主走心时评论发癫 = 杠精）
        const tender = isTenderPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined);
        const tenderLine = tender
          ? '\n\n【本帖判定：走心帖（文艺/深情/表白）】楼主处于感性、浪漫或私密的情境中——TA 在走心。本批评论的语气必须沉下来跟帖子同频：被戳中（「这句话我记得很久」）、吃狗粮（酸一下但祝福）、认真祝福（99/祝好）、或文艺地接一句，都可以；「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类过于聒噪、阴阳怪气的烂梗一个字都不许出现（「锁死」「放毒」在普通网友语境里是阴阳怪气，跟夸人「甜」完全两个极端；楼主走心你发癫 = 语境错乱，直接废稿）；玩梗者/暴躁/阴阳怪气视角本批自动失效。'
          : '';
        // v35：吃瓜爆料帖（偶遇明星/偷拍/疑似恋情）→ 求锤风向指令——爆料语境下
        // 网友第一反应是好奇和要证据，不是磕糖（「好甜/B哥稳」= 情绪错位）
        const scoop = isScoopPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined) && !tender;
        const scoopLine = scoop
          ? '\n\n【本帖判定：吃瓜爆料帖（偶遇/偷拍/疑似恋情）】楼主在爆料，评论区第一反应是好奇和要证据：至少一半评论是——求图求锤（没图说个锤子/求原图/拍照的时候在干嘛）、猜当事人身份（B哥到底是谁/查了下时间线）、震惊蹲后续、粉丝心态（要塌了/粉丝还有3秒到达战场/跑路了）；磕糖甜评（好甜/好稳/锁死/好配）最多 1 条——楼主都怕被代拍发现了，粉丝的第一反应是慌，不是嗑糖。'
          : '';
        // v44【防杠精安全锁】：善意短帖（夸奖/晚安/自拍分享，如「总而言之你很可爱」）→
        // 评论区必须同样友好；生成时注入风向指令 + 运行时过滤双保险
        // v45【拿错剧本】：矩阵 NPC 的身份套路此刻同样让位（瓜主/营销号也按
        // 普通网友友好回复，不套爆料预告/通稿模板）
        const benign = isBenignPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined);
        const benignLine = benign
          ? '\n\n【本帖判定：善意短帖（夸奖/晚安/感谢/自拍分享）】楼主情绪友好、毫无争议点——本批评论必须同样友好：夸回去、接梗、温和提问、道晚安都行；任何攻击、阴阳怪气、质疑动机、P图指控，或脑补「有人骂楼主/帮楼主说公道话」这类帖里不存在的剧情，全部直接废稿。杠精视角（质疑/杠精/暴躁老哥/阴阳怪气）本批自动失效，改用共情者/好奇宝宝/玩梗者的友好版；带鲜明身份的矩阵 NPC（瓜主/营销号/站姐等）本批也一律退回普通网友视角友好互动，绝不把身份模板（爆料预告「明天十点开团」/通稿腔/控评话术）和口头禅硬套到这种帖子上——拿错剧本＝废稿。'
          : '';
        const spec = personas
          .map((p, i) => {
            // v9：语言铁律——评论语言跟随帖子，不跟随评论者母语；
            // 外语网友也用帖子语言评论，最多带 1-3 个母语字符口癖
            const langNote =
              postLang === 'zh-Hans'
                ? p.lang !== 'zh-Hans'
                  ? `；母语${langLabel(p.lang)}，但评论必须用简体中文，最多带1-3个母语字符的口癖`
                  : ''
                : `；评论语言跟随帖子用${langLabel(postLang)}或简体中文`;
            // v43【NPC 记忆·人设连贯】：这位网友在楼主帖下留过的言——对楼主的态度延续
            //（昨天怼过楼主的今天开口就是「怎么又是你」）；无史不注入
            const memNote = p.npcHistory ? `；TA记得楼主：${p.npcHistory}——TA对楼主的印象和态度要延续之前` : '';
            // 【多世界观】矩阵 NPC：身份人设必须完全代入（鲜明身份是刻意设计，
            // 不降级为「只学语气」）；普通网友仍走防串台降级渲染
            // v45【拿错剧本】：矩阵 NPC 的身份人设带「领域对口才可用」条件——
            // 硬性「必须完全代入」会让狗仔瓜主在私人情感帖下机械降神套模板
            return p.matrix
              ? `${i + 1}. ${p.name}（身份人设·代入这个身份与性格的口吻评论：${p.persona}${langNote}${memNote}｜注意：你的身份套路与口头禅只在帖子内容与你身份领域对口时才可出场；这帖若是私人情感、善意夸奖、撒糖互动或与你领域无关的日常，就退回普通网友视角围绕帖子本身评论，绝不硬套身份模板——拿错剧本＝废稿）`
              : `${i + 1}. ${p.name}（口吻参考·只学语气和打字习惯，其中出现的一切具体事物（职业、作品、品牌、道具、经历、称呼）除非主帖本身提到，否则一个字都不许出现在评论里：${p.persona}${langNote}${memNote}）`;
          })
          .join('\n');
        // v43【NPC 记忆】：楼主过往发过的帖（真实背景——引用不算跑题不算幻觉；缺省零注入）
        const posterHistory =
          typeof body.posterHistory === 'string' && body.posterHistory.trim()
            ? `${body.posterHistory.slice(0, 800)}\n\n（上面是你对楼主的背景记忆——评论可以自然带出（接旧事、感叹TA的变化），但每条评论主体仍要针对当前帖；没给这个块时，绝不许臆想楼主的任何历史）\n\n`
            : '';
        // v43（B2）【记忆例外固定行】：部分网友带「TA记得楼主」记忆时的引用许可
        // 写进用户消息——用户自定义模板覆盖不会丢掉这条豁免（默认模板里的
        // 例外条款只是其中一份）；无史时零注入
        const npcMemRule = personas.some((p) => p.npcHistory)
          ? '名单里部分网友带着「TA记得楼主」的真实记忆（系统给的真实背景）：允许认脸（「怎么又是你」）、接旧事、延续之前对楼主的态度和语气，但每条评论主体仍要针对当前帖，旧事最多点一句；没带记忆的网友就是纯路人，绝不许臆想楼主的任何历史。\n\n'
          : '';
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              front + sysPrompt(promptOv, 'comments', {
                expect,
                langRule:
                  `# 语言铁律\n这是${langLabel(postLang)}帖子` +
                  (postLang === 'zh-Hans'
                    ? '：所有评论必须以简体中文为主体，最多偶尔夹杂 1-3 个外文字符（www、ㅋㅋ、草），绝对禁止整句英语/日语/韩语/繁体中文的评论'
                    : '：评论用该语言写，要像母语网友的网络口吻；也可以用简体中文') +
                  '；每位网友的母语只影响口癖和语气，不改变评论语言。\n',
              }),
          },
          {
            role: 'user',
            // v25：开头 = 锚定句（带楼主网名）+ 原封不动的帖子正文与话题标签；
            // 引战帖注入「骂声一片」风向指令；输出 [{thought, comment}] JSON 数组
            content: `${posterHistory}${anchorHeadOf(post)}\n${topicLine}${flameLine}${tenderLine}${scoopLine}${benignLine}\n\n${npcMemRule}请以这 ${expect} 位网友的口吻各写一条一级评论（都是直接评论上面这篇帖子本身，不是回复别人；先在 thought 里完成核心矛盾/情绪/视角分析，再写 comment；输出恰好 ${expect} 个对象的 JSON 数组，第 N 个对象对应第 N 位网友；comment 只能是评论本身的纯文本——绝不许把指令原文、话题词表、JSON 结构或「废稿」这类规则字眼写进 comment）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
          },
        ];
        // v35 校验链（清洗 → 长度 → 语言 → 泄露 → 万能句式 → 称呼串线 → 走心聒噪
        // → 爆料磕糖限额 → 领域私货 → 锚定）捕成函数：过滤后有效数不足半数时
        // 带着明确错误原因严格重试一次（旧版在过滤前判重试，泄露稿全部白给）
        const catchallOk = postAllowsCatchall(postContentRaw);
        const postOwnerName = typeof post.authorName === 'string' ? post.authorName : '';
        const commenterNames = personas.map((p) => p.name);
        const runChain = (src: string[]): string[] => {
          let catchallUsed = false;
          let sweetUsed = false; // v35：爆料帖磕糖甜评限 1 条
          const kept: string[] = []; // v35：批内复读去重（保留首条）
          return src
            .map((s) => sanitizeCommentText(stripReplyPrefix(s)))
            .filter((s) => s.length >= 3 && s.length <= 110)
            // v9 强校验：中文帖出现整句外语 = 串台级错误 → 作废
            .filter((s) => !violatesCommentLang(s, postLang))
            // v35 第一道闸：JSON 残留 / 系统指令泄露（{"thought":…}/【本帖核心话题词…】）→ 作废
            .filter((s) => !structuredLeakIn(s))
            .filter((s) => {
              if (!universalPhraseIn(s)) return true;
              if (!catchallOk || catchallUsed) return false;
              catchallUsed = true;
              return true;
            })
            // v25 称呼/名称串线：屿哥（拿评论者网名拼称呼）/自称网名 → 作废
            .filter((s) => !personaBleedIn(s, postOwnerName, commenterNames))
            // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱作废
            .filter((s) => !(tender && loudMemeIn(s)))
            // v44 防杠精：善意短帖 + 虚空索敌/无端攻击（公道话/被骂/P图指控）→ 作废
            .filter((s) => !(benign && imaginaryEnemyIn(s)))
            // v45 拿错剧本：善意/走心帖 + 狗仔预告式身份模板 → 机械降神作废
            .filter((s) => !((benign || tender) && tabloidScriptIn(s)))
            // v35 爆料帖：磕糖甜评（好甜/好稳/锁死）超出 1 条 → 作废
            .filter((s) => {
              if (!scoop || !sweetShipIn(s)) return true;
              if (sweetUsed) return false;
              sweetUsed = true;
              return true;
            })
            // v25 领域私货：评论携带 ≥2 个主帖领域之外的关键词（剧+特调混进保研帖）→ 作废
            .filter((s) => !offTopicIn(s, postContentRaw))
            // v14 锚定强校验：不呼应核心话题词 / 串台 / AI 废话 → 作废
            // v43【NPC 记忆】：锚定语料并入楼主历史帖（NPC 提旧事「楼主终于走出来了」也能过校验）
            .filter((s) => commentAnchored(s, `${postContentRaw} ${posterHistory}`))
            // v35 批内复读去重：多条一级评论互相复读（同措辞换网名）→ 只保留首条
            .filter((s) => {
              if (kept.some((k) => isParrotReply(s, k))) return false;
              kept.push(s);
              return true;
            });
        };
        const raw = (await completeWithFallback(config, messages)).text;
        // v22：[{thought, comment}] JSON 数组解析（thought 是「先分析后生成」的
        // 内部思考，不上屏，只取 comment）
        let list = runChain(extractThoughtComments(raw));
        // v35：过滤后有效数不足半数（JSON 解析失败/大量泄露或废稿）→ 严格重试一次
        if (list.length < Math.ceil(expect / 2)) {
          try {
            const raw2 = (
              await completeWithFallback(config, [
                ...messages,
                { role: 'assistant', content: raw.slice(0, 1500) },
                {
                  role: 'user',
                  content: `你上一次的输出大量无效（不是合法 JSON 数组，或 comment 里混进了指令原文/JSON结构/万能句式）。重新输出：恰好 ${expect} 个对象、只含 thought 和 comment 两个字段的 JSON 数组，除 JSON 本身外禁止任何文字，不要代码围栏。再次提醒：comment 只能是评论本身的纯文本（3~100 字），绝不许出现 "thought"、"comment"、【本帖核心话题词】这类字段名/指令原文/规则字眼；必须针对帖子的具体内容，绝不出现万能句式（蹲后续/这瓜保熟吗/等一个下文/让子弹飞）。`,
                },
              ])
            ).text;
            const retry = runChain(extractThoughtComments(raw2));
            if (retry.length > list.length) list = retry;
          } catch {
            /* 重试失败：按现有结果返回，客户端不铺模板（宁缺毋滥） */
          }
        }
        // v40：personas 与评论一一对应（第 N 条对应第 N 位网友）：超发/逐行兑底解析的多余条目截掉
        return NextResponse.json({ items: list.slice(0, expect) });
      }

      // subreplies：给 threads 里的每条评论各写一条回复（来自 personas 对应网友）
      // v26：单调用线程上限 12→30（楼中楼需求「评论下面 1-5 人」+ 深层嵌套——
      // 每条一级评论 1~5 条直接回复、部分回复再被回复，一批常 20~40 线程）
      // v35：threads 增加可选 prev（同楼层已存在的回复——生成时明确避开，杜绝盖楼复读）
      // v41（C3）：过滤空内容 threads 时 personas 同步跟齐——客户端按全量列表
      // 一一对应传人设，服务端单边 filter 会让人设错位（A 的回复安到 B 头上）
      const threadsRaw = Array.isArray(body.threads)
        ? (body.threads as Record<string, unknown>[])
            .slice(0, 30)
            .map((h) => ({
              authorName: typeof h.authorName === 'string' ? h.authorName.slice(0, 24) : '网友',
              content: typeof h.content === 'string' ? h.content.slice(0, 160) : '',
              prev: Array.isArray(h.prev)
                ? (h.prev as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4).map((x) => x.slice(0, 80))
                : [],
            }))
        : [];
      const keepIdx = threadsRaw.map((h, i) => (h.content ? i : -1)).filter((i): i is number => i >= 0);
      const threads = keepIdx.map((i) => threadsRaw[i]);
      if (!threads.length) return NextResponse.json({ error: 'threads 为空' }, { status: 400 });
      // v41（C3）：客户端与 threads 等长传人设时按原始下标取（过滤后不错位）；
      // 长度不匹配时退回旧版取模兑底
      const personasAligned = personas.length === threadsRaw.length;
      const personaOf = (i: number) => (personasAligned ? personas[keepIdx[i]] : personas[i % personas.length]);
      const expect = threads.length;
      const spec = threads
        .map((h, i) => {
          const p = personaOf(i);
          const langNote =
            postLang === 'zh-Hans'
              ? p.lang !== 'zh-Hans'
                ? `；母语${langLabel(p.lang)}，但回复必须用简体中文，最多带1-3个母语字符的口癖`
                : ''
              : `；回复语言跟随帖子用${langLabel(postLang)}或简体中文`;
          // v35：同楼层已有的回复（观点/措辞都必须避开——盖楼复读的解药）
          const prevLine = h.prev.length
            ? `｜这层楼已有人说：「${h.prev.join('」「')}」——你绝不许重复他们的观点和措辞，换一个完全不同的角度`
            : '';
          // v43（A2）【NPC 记忆】：这位回复者在楼主帖下留过的言（对楼主态度延续——
          // 楼中楼里的「怎么又是你」；无史不注入）
          const memNote = p.npcHistory ? `；TA记得楼主：${p.npcHistory}——TA对楼主的印象和态度要延续之前` : '';
          // v25：人设降级为「口吻参考」——其中具体事物（职业/作品/道具/经历）
          // 除非主帖和被回复评论提到，否则一个字不许进回复（防 Persona Bleed）；
          // 【多世界观】矩阵 NPC 不降级：身份人设代入（v45：带领域对口条件——
          // 拿错剧本安全锁，私人帖下不硬套身份模板）
          return p.matrix
            ? `${i + 1}. 评论（楼主是「${typeof post.authorName === 'string' ? post.authorName : '楼主'}」；${h.authorName} 说：「${h.content}」${prevLine}）→ 由 ${p.name} 回复（身份人设·代入这个身份与性格的口吻回复：${p.persona}${langNote}${memNote}｜注意：身份套路与口头禅只在主帖/楼层内容与你身份领域对口时才可出场；这帖若是私人情感、善意互动或与你领域无关的日常，就退回普通网友视角接楼层的话，绝不硬套身份模板——拿错剧本＝废稿）`
            : `${i + 1}. 评论（楼主是「${typeof post.authorName === 'string' ? post.authorName : '楼主'}」；${h.authorName} 说：「${h.content}」${prevLine}）→ 由 ${p.name} 回复（口吻参考·只学语气，其中具体事物严禁入评：${p.persona}${langNote}${memNote}）`;
        })
        .join('\n');
      // v28：走心帖（文艺/深情/表白）→ 楼中楼语气同频指令（楼主走心时楼中楼也发癫 = 杠精现场）
      const tender = isTenderPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined);
      const tenderLine = tender
        ? '\n\n【本帖判定：走心帖（文艺/深情/表白）】楼主在走心（感性/浪漫/私密情境）：楼中楼也要沉下来跟主帖同频——附和感动、酸（克制版）、祝福、文艺接梗都行；「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类聒噪/阴阳怪气烂梗一个字不许出现（楼主走心你发癫 = 语境错乱，废稿）。'
        : '';
      // v35：吃瓜爆料帖 → 楼中楼也是求锤/猜身份心态，磕糖甜评最多 1 条
      const scoop = isScoopPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined) && !tender;
      const scoopLine = scoop
        ? '\n\n【本帖判定：吃瓜爆料帖（偶遇/偷拍/疑似恋情）】楼中楼跟一级评论同风向：求图求锤、猜当事人身份、震惊蹲后续、粉丝心态（要塌了/快跑）；「好甜」「好稳」「锁死」式磕糖甜评整批最多 1 条。'
        : '';
      // v44【防杠精安全锁】：善意短帖 → 楼中楼同样必须友好（不能只治一级评论）
      // v45【拿错剧本】：矩阵 NPC 身份套路同样让位
      const benign = isBenignPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined);
      const benignLine = benign
        ? '\n\n【本帖判定：善意短帖（夸奖/晚安/感谢/自拍分享）】楼主情绪友好、毫无争议点——楼中楼也必须同样友好：附和夸奖、接梗、温和提问都行；任何攻击、阴阳怪气、P图指控，或脑补「有人骂楼主/帮楼主说公道话」这类帖里不存在的剧情，全部直接废稿；带鲜明身份的矩阵 NPC（瓜主/营销号/站姐等）本批一律退回普通网友视角友好接话，绝不把身份模板（爆料预告「明天十点开团」/通稿腔/控评话术）和口头禅硬套到这种帖子上——拿错剧本＝废稿。'
        : '';
      // v43（A2）【NPC 记忆】：部分回复者带「TA记得楼主」记忆时的固定规则行
      //（写在用户消息里——用户自定义模板覆盖不会丢掉这条豁免）
      const npcMemRule = personas.some((p) => p.npcHistory)
        ? '名单里部分网友带着「TA记得楼主」的真实记忆（系统给的真实背景）：允许认脸（「怎么又是你」）、接旧事、延续之前对楼主的态度，但回复主体仍要回应当前楼层的话；没带记忆的网友就是纯路人，绝不许臆想楼主的任何历史。\n\n'
        : '';
      // v43（A2）：本批 NPC 留言史合集（锚定校验语料用——认脸/提旧事的楼中楼
      // 不因「不呼应当前帖」被误杀）
      const memCorpus = personas.filter((p) => p.npcHistory).map((p) => p.npcHistory).join(' ');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            front + sysPrompt(promptOv, 'subreplies', {
              langRule:
                '\n【语言铁律】' +
                (postLang === 'zh-Hans'
                  ? '这是中文帖：所有楼中楼必须以简体中文为主体，最多偶尔夹杂 1-3 个外文字符（www、ㅋㅋ、草），绝对禁止整句英语/日语/韩语/繁体'
                  : '评论语言跟随帖子语言，也可用简体中文') +
                '。',
            }),
        },
        {
          role: 'user',
          // v15（用户强制要求）：用户消息开头 = 锚定句 + 原封不动的主帖正文与话题标签
          // v35：防复读铁律进用户消息（系统模板可能被用户覆盖，此处双保险）
          // v41（C2）：avoid 防重复表注入楼中楼——本帖最近说过的评论不再重复
          // v43（A2）：npcMemRule 记忆豁免固定行（同上双保险）
          content: `${anchorHeadOf(post)}\n\n${topicLine}${tenderLine}${scoopLine}${benignLine}${avoidLine}\n\n${npcMemRule}评论区里有下面 ${expect} 条评论，请逐条写出对应的楼中楼回复（每条直接写正文，针对那条评论说的话回应并呼应主帖话题词，不要带任何@或「回复」前缀；输出 ${expect} 行）。防复读铁律：绝对不许重复被回复那条评论的核心词汇——对方说「代拍太可怕」你就绝不能再写「代拍可怕」，要么换完全不同的措辞谈同一件事，要么直接反驳/爆料/抖机灵换角度；多条回复针对同一条评论时（或楼层里已有人说过类似的话时），各自角度必须完全不同；回复正文里绝不许出现「thought」「废稿」等任何指令/规则字眼或 JSON 结构。\n${spec}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      // v35：模型偶尔无视「输出 N 行」契约改吐 JSON 数组——先按 JSON 解析
      //（对象取 reply/comment/text/content 字段或纯字符串），行拆兜底且过滤泄露
      const parseThreadLines = (text: string): string[] => {
        const parsed = parseLooseJSON<unknown[]>(extractThinkBlocks(text ?? '').text);
        if (Array.isArray(parsed)) {
          const out = parsed.map((o) => {
            if (typeof o === 'string') return o;
            if (o && typeof o === 'object' && !Array.isArray(o)) {
              const rec = o as Record<string, unknown>;
              for (const k of ['reply', 'comment', 'text', 'content']) {
                if (typeof rec[k] === 'string' && rec[k].trim()) return rec[k];
              }
            }
            return '';
          });
          if (out.filter(Boolean).length >= Math.ceil(expect / 2)) return out.slice(0, expect);
        }
        return [];
      };
      let rawList = parseThreadLines(raw);
      if (!rawList.length) {
        // v14：位置对齐校验（无效项置空串由客户端按位跳过，不向后错位）
        rawList = await batchWithRetry(config, messages, raw, expect, 600);
      }
      // v22：万能句式豁免（未完结八卦/求助帖）且整批限 1 条
      const catchallOk = postAllowsCatchall(postContentRaw);
      let catchallUsed = false;
      // v35：爆料帖磕糖甜评限 1 条
      let sweetUsed = false;
      // v25：称呼串线检测名单（本批回复者网名）+ 楼主网名
      const replierNames = personas.map((p) => p.name);
      const postOwnerName = typeof post.authorName === 'string' ? post.authorName : '';
      const list = threads.map((h, i) => {
        const s = rawList[i] ?? '';
        const t = sanitizeCommentText(stripReplyPrefix(s));
        const ctx = `${h.content} ${postContentRaw}`;
        // v43（A2）：锚定语料并入本批 NPC 留言史（认脸/提旧事的楼中楼不因
        // 「不呼应当前帖」被误杀；领域私货检测仍只看当前帖——旧帖不算私货）
        const anchorCtx = memCorpus ? `${ctx} ${memCorpus}` : ctx;
        // 用户规范：回复 3~100 字（留容差）
        if (t.length < 3 || t.length > 110) return '';
        if (violatesCommentLang(t, postLang)) return '';
        // v35 第一道闸：JSON 残留 / 系统指令泄露 → 作废
        if (structuredLeakIn(t)) return '';
        // v22 万能句式：非豁免帖全废；豁免帖限 1 条
        if (universalPhraseIn(t)) {
          if (!catchallOk || catchallUsed) return '';
          catchallUsed = true;
        }
        // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱作废
        if (tender && loudMemeIn(t)) return '';
        // v44 防杠精：善意短帖 + 虚空索敌/无端攻击 → 作废
        if (benign && imaginaryEnemyIn(t)) return '';
        // v45 拿错剧本：善意/走心帖 + 狗仔预告式身份模板 → 机械降神作废
        if ((benign || tender) && tabloidScriptIn(t)) return '';
        // v35 爆料帖：磕糖甜评超 1 条 → 作废
        if (scoop && sweetShipIn(t)) {
          if (sweetUsed) return '';
          sweetUsed = true;
        }
        // v25 称呼/名称串线：拿回复者网名拼称呼（屿哥）/自称网名 → 作废
        if (personaBleedIn(t, postOwnerName, replierNames)) return '';
        // v35 复读机检测：与被回复评论词面高度重合（「代拍太可怕了」式盖楼）→ 作废
        if (isParrotReply(t, h.content)) return '';
        // v35 同楼层去重：与楼层里已有的回复复读撞车 → 作废
        if (h.prev.some((pv) => isParrotReply(t, pv))) return '';
        // v25 领域私货：回复携带 ≥2 个「被回复评论+主帖」领域之外的关键词 → 作废
        if (offTopicIn(t, ctx)) return '';
        // 楼中楼必须呼应「被回复评论 + 主帖」（v43-A2：+ NPC 留言史语料）
        if (!commentAnchored(t, anchorCtx)) return '';
        return t;
      });
      // v35 批内同目标去重：同一评论的多条回复互相复读（不同楼但同样话）→ 保留首条
      const byTarget = new Map<string, string[]>();
      threads.forEach((h, i) => {
        const key = h.content.slice(0, 40);
        const kept = byTarget.get(key) ?? [];
        const t = list[i];
        if (t && kept.some((k) => isParrotReply(t, k))) {
          list[i] = '';
          return;
        }
        if (t) kept.push(t);
        byTarget.set(key, kept);
      });
      // v41（C3）：结果按原始 threads 下标回填——客户端按全量列表对位消费
      //（服务端过滤过空内容线程，直接返回会把回复错位安到别的评论名下）
      const outFull = threadsRaw.map(() => '');
      keepIdx.forEach((orig, i) => {
        outFull[orig] = list[i] ?? '';
      });
      return NextResponse.json({ items: outFull });
    }

    // ================= v33【AI 真人社交】角色驱动生成（charPost/charEngage/charReply） =================

    if (kind === 'charPost' || kind === 'charEngage' || kind === 'charReply' || kind === 'followAsk' || kind === 'ownerReply') {
      const c = (body.char ?? {}) as Record<string, unknown>;
      const chName = typeof c.name === 'string' ? c.name.slice(0, 24) : '好友';
      const chPersona = typeof c.persona === 'string' ? c.persona.slice(0, 900) : '';
      const chRelation = typeof c.relation === 'string' ? c.relation.slice(0, 80) : '好友';
      const chMood = typeof c.mood === 'string' ? c.mood.slice(0, 400) : '';
      const chMemory = typeof c.memory === 'string' ? c.memory.slice(0, 2000) : '';
      const chRecent = Array.isArray(c.recent)
        ? (c.recent as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3)
        : [];
      // 身份块（三 kind 共用）：人设 + 情绪 + 对用户的记忆 + 「你是真人不是回帖机器」
      const identity = [
        '# 你是谁（第一人称，严格保持，绝不跳出）',
        `你是「${chName}」，${userName}的${chRelation}——你不是AI助手、不是万能回帖机器人：你是一个有自己生活、脾气和说话习惯的真实的人，在 X 论坛有一个自己的账号，像真人刷社交软件一样发帖、点赞、回评论。`,
        chPersona ? `【你的资料卡】\n${chPersona}` : '',
        chMood ? `【你此刻的心情】\n${chMood}` : '',
        chMemory ? `【你对${userName}的记忆（你们真实经历过的事——聊天时自然运用，不要逐条复述）】\n${chMemory}` : '',
        chRecent.length ? `【你最近发过的帖子（别重复话题，可以接话茬）】\n${chRecent.map((r) => `- ${r.slice(0, 60)}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      // ---- charPost：角色主动发一条帖子 ----
      if (kind === 'charPost') {
        const userPosts = typeof body.userPosts === 'string' ? body.userPosts.slice(0, 800) : '';
        const events = Array.isArray(body.events)
          ? (body.events as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4)
          : [];
        const { plan: lp, target } = pickLenPlan();
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              front + sysPrompt(promptOv, 'charPost', {
                identity,
                chName,
                userName,
                lenLabel: lp.label,
                lenMin: lp.min,
                lenMax: lp.max,
                lenTarget: target,
                lenHint: lp.hint,
              }),
          },
          {
            role: 'user',
            content:
              [
                userPosts ? `【${userName}最近在论坛发的帖子（你刷到了，可以视心情回应/吐槽/关心，也可以无视）】\n${userPosts}` : '',
                // v40：事件条目截断（与其余素材同口径，防超长输入打爆提示词）
                events.length ? `【你今天的生活素材（选0~2个融入，也可完全不用）】\n${events.map((e) => `- ${e.slice(0, 200)}`).join('\n')}` : '',
                `请以「${chName}」的口吻发这条帖子（直接输出严格JSON）。${bjTimeLine()}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
          },
        ];
        const raw = (await completeWithFallback(config, messages)).text;
        // 解析+校验复用 posts 管线（sanitize/四档字数/配图三元校验/话题规范化）
        const parsed = extractPostItems(raw);
        const aligned = alignPostItems(parsed, 1, [chName], new Set());
        const item = aligned[0];
        if (item && item.content) {
          return NextResponse.json({ content: item.content, textImage: item.textImage });
        }
        // 严格重试一次（强调JSON格式与字数档）；v40：保留原 system（人设+情绪+记忆+提示词
        // 覆盖都在里面——重试不能丢掉角色口吻），只追加纠偏指令；并包 try/catch 防重试
        // 异常把可降级的空结果升级成 500
        let raw2 = '';
        try {
          raw2 = (
            await completeWithFallback(config, [
              ...messages,
              { role: 'assistant', content: raw.slice(0, 400) },
              {
                role: 'user',
                content: `你上一次的输出无效（不是合法 JSON 或字数档不符）。重新以「${chName}」的口吻输出这条帖子：一个严格合法的 JSON 对象（{"thought","content","has_image","image_description"}），content 字数必须落在${lp.min}~${lp.max} 字，除 JSON 本身外禁止任何文字，不要代码围栏。`,
              },
            ])
          ).text;
        } catch {
          /* 重试失败：返回空（客户端宁缺毋滥） */
        }
        const aligned2 = raw2 ? alignPostItems(extractPostItems(raw2), 1, [chName], new Set()) : [];
        const item2 = aligned2[0];
        return NextResponse.json({
          content: item2?.content ?? '',
          textImage: item2?.textImage ?? '',
        });
      }

      // ---- charEngage：角色刷到用户帖子 → 决定点赞/评论/关注 ----
      if (kind === 'charEngage') {
        const p = (body.post ?? {}) as Record<string, unknown>;
        const postContent = typeof p.content === 'string' ? p.content.slice(0, 600) : '';
        // v44【AI 关注者】：角色当前是否已关注机主（follow 决策的边界信息）
        const followsUser = c.followsUser === true;
        const followLine = `\n\n【关注状态】你${followsUser ? '已经关注了TA的X论坛主页（follow 一律输出 false，别重复关注）' : '还没有关注TA的X论坛主页——如果这条帖子让你想长期看TA发的内容，可以 follow=true（关注是一次性动作，平时大多数时候输出 false）'}。`;
        const mediaDesc = typeof p.mediaDesc === 'string' && p.mediaDesc.trim() ? `\n（帖子配图：${p.mediaDesc.slice(0, 160)}）` : '';
        // v43（A4）【已有评论感知】：帖子下已有的一级评论（角色评论必须避开——
        // 防与先到的 NPC 撞观点/复读；空数组零注入）
        const topComments = Array.isArray(p.topComments)
          ? (p.topComments as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 80))
          : [];
        const topCommentsLine = topComments.length
          ? `\n\n【这条帖子评论区已有的评论（你的评论要和这些完全不同——观点、角度、措辞都不许撞；有人已经说过的，你就换角度或聊别的细节）】\n${topComments.map((c) => `- ${c}`).join('\n')}`
          : '';
        // v41（B8）：语言校验跟随帖子（客户端传 lang；中文帖才拒整句外语，
        // 外语帖不再被写死的 zh-Hans 误杀全部评论）
        const engageLang = typeof p.lang === 'string' && LANG_LABELS[p.lang] ? p.lang : 'zh-Hans';
        if (!postContent) return NextResponse.json({ error: 'post 为空' }, { status: 400 });
        const raw = (await completeWithFallback(config, [
          {
            role: 'system',
            content:
              front + sysPrompt(promptOv, 'charEngage', { identity, userName, chRelation }),
          },
          { role: 'user', content: `【${userName}的帖子】\n${postContent}${mediaDesc}${topCommentsLine}${followLine}\n\n请决定你的反应（严格JSON）。${bjTimeLine()}` },
        ])).text;
        // v40：数组包裹/畸形 JSON 兑底——[{...}] 取首个对象；整体解析失败时按
        // "comment"/"like" 字段正则恢复（一次点赞/评论决策不因格式问题白给）
        const parsedAny = parseLooseJSON<unknown>(extractThinkBlocks(raw).text);
        let parsed: Record<string, unknown> = {};
        if (Array.isArray(parsedAny)) {
          parsed = (parsedAny.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined) ?? {};
        } else if (parsedAny && typeof parsedAny === 'object') {
          parsed = parsedAny as Record<string, unknown>;
        }
        if (!('comment' in parsed) && !('like' in parsed)) {
          const text = extractThinkBlocks(raw).text;
          const cm = text.match(/"comment"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (cm) parsed = { ...parsed, comment: unescapeJsonStr(cm[1]) };
          if (/"like"\s*:\s*true/.test(text)) parsed = { ...parsed, like: true };
        }
        const like = parsed.like === true;
        // v44【AI 关注者】：自主关注决策（已关注 → 永远 false）
        const follow = !followsUser && parsed.follow === true;
        // v40：先 cleanText（剥引号包裹/舞台指示）再做长度与内容校验——旧序校验后
        // 再截断可能跌破下限，把合格评论误杀
        let comment = typeof parsed.comment === 'string' ? cleanText(sanitizeCommentText(stripReplyPrefix(parsed.comment)), 150) : '';
        if (comment && (comment.length < 15 || comment.length > 150)) comment = '';
        if (comment && (isBannedFiller(comment) || universalPhraseIn(comment))) comment = '';
        // v35：JSON 残留 / 指令泄露 → 作废（角色评论同样不能把 thought 字段吐出来）
        if (comment && structuredLeakIn(comment)) comment = '';
        // 锚定：评论必须接得上帖子内容（与服务端评论管线同口径）
        if (comment && !commentAnchored(comment, stripImgPh(postContent))) comment = '';
        // v41（B8）：语言跟随帖子（不再写死简体中文）
        if (comment && violatesCommentLang(comment, engageLang)) comment = '';
        return NextResponse.json({ like, comment, follow });
      }

      // ---- followAsk（v44【AI 关注者】）：聊天/私信里被请求关注机主 → 按人设自主决定 ----
      if (kind === 'followAsk') {
        const source = typeof body.source === 'string' ? body.source.slice(0, 8) : 'chat';
        const followsUser = c.followsUser === true;
        const askLine =
          source === 'dm'
            ? `${userName}刚才在 X 论坛私信里让你关注 TA 的主页。`
            : `${userName}刚才在和你聊天时让你去 X 论坛关注 TA。`;
        const raw = (await completeWithFallback(config, [
          { role: 'system', content: front + sysPrompt(promptOv, 'followAsk', { identity, userName }) },
          {
            role: 'user',
            content: `${askLine}${followsUser ? '（其实你早就关注TA了——照实按已关注处理。）' : ''}\n\n要不要关注由你完全自主决定：按你的人设、脾气、你们的关系和此刻的心情综合判断——想看TA以后发什么就关注；觉得麻烦/闹别扭/放不下面子也可以拒绝，真人不会百依百顺。${bjTimeLine()}`,
          },
        ])).text;
        const parsedAny = parseLooseJSON<unknown>(extractThinkBlocks(raw).text);
        let parsed: Record<string, unknown> = {};
        if (Array.isArray(parsedAny)) {
          parsed = (parsedAny.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined) ?? {};
        } else if (parsedAny && typeof parsedAny === 'object') {
          parsed = parsedAny as Record<string, unknown>;
        }
        if (!('follow' in parsed) && /"follow"\s*:\s*true/.test(extractThinkBlocks(raw).text)) parsed = { ...parsed, follow: true };
        return NextResponse.json({ follow: !followsUser && parsed.follow === true });
      }

      // ---- ownerReply（v46【楼主回复】）：AI 挑选帖子下的网友评论回复 ----
      // · ownPost：AI 自己发的帖 → 楼主视角（废话评论无视、争议/提问才回）；
      // · userPost：用户发的帖 → 护短围观视角（按人设记忆决定要不要帮TA回一句）。
      // 严格筛选逻辑（用户明确要求）：不是每条都回，先按人设+帖子内容挑选，
      // 再以本人口吻回复选中的那条；全都不值得回就 target=-1（无损无视）。
      if (kind === 'ownerReply') {
        const mode = body.mode === 'userPost' ? 'userPost' : 'ownPost';
        const p = (body.post ?? {}) as Record<string, unknown>;
        const postContent = typeof p.content === 'string' ? p.content.slice(0, 600) : '';
        if (!postContent) return NextResponse.json({ error: 'post 为空' }, { status: 400 });
        const mediaDesc = typeof p.mediaDesc === 'string' && p.mediaDesc.trim() ? p.mediaDesc.slice(0, 160) : '';
        const replyLang = typeof body.postLang === 'string' && LANG_LABELS[body.postLang] ? body.postLang : 'zh-Hans';
        // 待处理的网友评论（编号即 target 取值；最多 6 条）
        const comments = Array.isArray(body.comments)
          ? (body.comments as Record<string, unknown>[])
              .slice(0, 6)
              .map((c, i) => ({
                name: typeof c.name === 'string' ? c.name.slice(0, 24) : `网友${i + 1}`,
                persona: typeof c.persona === 'string' ? c.persona.slice(0, 160) : '',
                content: typeof c.content === 'string' ? c.content.slice(0, 200) : '',
              }))
              .filter((c) => c.content)
          : [];
        if (!comments.length) return NextResponse.json({ target: -1, text: '' });
        const commentsLine = comments
          .map((c, i) => `${i}. ${c.name}${c.persona ? `（${c.persona}）` : '（普通网友）'}说：「${c.content}」`)
          .join('\n');
        // 场景块（模板 {{scene}}）：楼主视角 / 护短围观视角
        const scene =
          mode === 'ownPost'
            ? `你发的帖子下面来了几条网友评论，你作为楼主刷到了。像真人楼主一样挑「最值得回」的一条回复——或者全都无视（废话评论不需要回，真人楼主也不回每一条）。`
            : `你在刷 X 论坛，看到${userName}（你的${chRelation}）发的帖子下面，有网友在评论区说话。你可以选择性参与：\n- 有人抬杠、阴阳怪气、说难听话 → 按你们的关系和你的脾气决定要不要「护短」帮TA回一句（也可以选择不掺和）；\n- 评论里有有意思的话题 → 可以插一句一起聊；\n- 只是普通互动、没必要掺和 → 完全可以无视（target=-1）。\n护短要护得自然——按你的性格来，别像家长出场，也别撒狗粮过头。`;
        const raw = (await completeWithFallback(config, [
          { role: 'system', content: front + sysPrompt(promptOv, 'ownerReply', { identity, userName, scene }) },
          {
            role: 'user',
            content: [
              mode === 'ownPost'
                ? `【你的帖子（你本人发的）】\n${postContent}${mediaDesc ? `\n（帖子配图：${mediaDesc}）` : ''}`
                : `【${userName}的帖子】\n${postContent}${mediaDesc ? `\n（帖子配图：${mediaDesc}）` : ''}`,
              `【帖子下的网友评论（编号 = target 取值）】\n${commentsLine}`,
              avoidLine,
              `请先按你的脾气挑选，再以「${chName}」的口吻回复选中的那条（严格JSON）。${bjTimeLine()}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ])).text;
        const parsedAny = parseLooseJSON<unknown>(extractThinkBlocks(raw).text);
        let parsed: Record<string, unknown> = {};
        if (Array.isArray(parsedAny)) {
          parsed = (parsedAny.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined) ?? {};
        } else if (parsedAny && typeof parsedAny === 'object') {
          parsed = parsedAny as Record<string, unknown>;
        }
        let target = typeof parsed.target === 'number' && Number.isFinite(parsed.target) ? Math.trunc(parsed.target) : -1;
        if (target < -1 || target >= comments.length) target = -1;
        let text = typeof parsed.reply === 'string' ? cleanText(sanitizeCommentText(stripReplyPrefix(parsed.reply)), 130) : '';
        if (target >= 0 && text) {
          const tc = comments[target];
          const anchorCorpus = stripImgPh(`${tc.content} ${postContent}`);
          const benignCtx = isBenignPost(postContent, mediaDesc) || isTenderPost(postContent, mediaDesc);
          // 回怼豁免：目标评论本身带攻击性（杠精/阴阳/P图指控/引战）→ 楼主回怼里的
          // 「杠精/对线」类词是正当反击，不按「无端攻击」拦截
          const targetHostile = isFlamePost(tc.content) || imaginaryEnemyIn(tc.content);
          if (text.length < 8 || text.length > 130) text = '';
          if (text && (isBannedFiller(text) || structuredLeakIn(text))) text = '';
          if (text && violatesCommentLang(text, replyLang)) text = '';
          // 锚定：必须接得住「被回复的评论 + 主帖」（防答非所问串台）
          if (text && !commentAnchored(text, anchorCorpus)) text = '';
          // v45 拿错剧本：善意/走心帖 + 狗仔预告式身份模板 → 丢弃（楼主回复同样不豁免）
          if (text && benignCtx && tabloidScriptIn(text)) text = '';
          // 无端攻击防线：目标评论是善意内容而回复却无端开喷（P图/装什么/杠精起手）→ 丢弃
          if (text && !targetHostile && imaginaryEnemyIn(text)) text = '';
          // 复读检测：不许原样复读被回复的评论
          if (text && isParrotReply(text, tc.content)) text = '';
        } else {
          target = -1;
          text = '';
        }
        return NextResponse.json({ target: target >= 0 && text ? target : -1, text: target >= 0 && text ? text : '' });
      }

      // ---- charReply：神回复（用户评论了角色的帖/评论） / thanks（用户点赞后的轻回应） ----
      const postContent = typeof body.postContent === 'string' ? body.postContent.slice(0, 1000) : '';
      const postAuthor = typeof body.postAuthor === 'string' ? body.postAuthor.slice(0, 24) : chName;
      const userComment = typeof body.userComment === 'string' ? body.userComment.slice(0, 300) : '';
      const thanks = body.thanks === true;
      // v41（B8）：语言校验跟随主帖（客户端传 postLang；不再写死简体中文）
      const replyLang = typeof body.postLang === 'string' && LANG_LABELS[body.postLang] ? body.postLang : 'zh-Hans';
      const mediaDesc =
        typeof body.mediaDesc === 'string' && body.mediaDesc.trim()
          ? `\n（帖子配图：${body.mediaDesc.slice(0, 160)}）`
          : '';
      const history = Array.isArray(body.history)
        ? (body.history as Record<string, unknown>[])
            .slice(-8)
            .map((h) => {
              const speaker =
                typeof h.speaker === 'string' && h.speaker.trim() ? h.speaker.slice(0, 24) : h.from === 'user' ? userName : chName;
              return `${speaker}：${typeof h.text === 'string' ? h.text.slice(0, 150) : ''}`;
            })
            .join('\n')
        : '';
      const raw = (await completeWithFallback(config, [
        {
          role: 'system',
          content:
            front + sysPrompt(promptOv, thanks ? 'charThanks' : 'charReply', { identity, userName }),
        },
        {
          role: 'user',
          content:
            [
              postContent ? `【你的帖子（${postAuthor} 发的）】\n${postContent}${mediaDesc}` : '',
              userComment ? `【${userName}的评论（你回的就是这条）】\n${userComment}` : '',
              history ? `【这层楼之前的对话（各有其名，别把别人的话当成自己说的）】\n${history}` : '',
              `请以「${chName}」的口吻回复。${bjTimeLine()}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
        },
      ])).text;
      // v40：先 cleanText 再校验长度（cleanText 剥离包裹后可能跌破下限——校验必须对着最终文本）
      const text = cleanText(sanitizeCommentText(stripReplyPrefix(raw)), 130);
      if (
        text.length >= (thanks ? 8 : 10) &&
        text.length <= (thanks ? 80 : 130) &&
        !violatesCommentLang(text, replyLang) &&
        !isBannedFiller(text) &&
        // v35：神回复同样禁止把指令原文/JSON 结构当话说（宁缺毋滥）
        !structuredLeakIn(text)
      ) {
        return NextResponse.json({ text });
      }
      return NextResponse.json({ text: '' });
    }

    if (kind === 'reply' || kind === 'dm') {
      const authorRaw = body.author as { name?: unknown; persona?: unknown; lang?: unknown; matrix?: unknown; char?: unknown; stranger?: unknown; relation?: unknown; mood?: unknown; memory?: unknown; forumMemory?: unknown; followAsk?: unknown; multi?: unknown; proactive?: unknown; dmLongMem?: unknown } | undefined;
      const name = typeof authorRaw?.name === 'string' ? authorRaw.name.slice(0, 24) : '网友';
      // 【多世界观】矩阵 NPC 的合并人设（身份+性格+口头禅）更长，放宽截断
      const persona =
        typeof authorRaw?.persona === 'string'
          ? authorRaw.persona.slice(0, authorRaw.matrix === true ? 360 : 300)
          : '普通论坛网友';
      const myLang = typeof authorRaw?.lang === 'string' && LANG_LABELS[authorRaw.lang] ? authorRaw.lang : 'zh-Hans';
      if (kind === 'reply') {
        const p = body.parent as { authorName?: string; content?: string } | undefined;
        // v24（用户本次 Prompt 规格）：楼层对话回复 = 根据【主帖内容】+【上一句对话】
        // 生成符合人类社交逻辑的回复（拒绝幻觉 / 紧扣上下文 / 20-80字口语化 / 直接输出正文）
        const lastLine = p?.content
          ? `【上一句对话】\n${p.authorName ?? '有人'}：${String(p.content).slice(0, 300)}`
          : '【上一句对话】\n（无——这是对主帖本身的第一条回复）';
        // v26：用户回复的那条评论（"我回复的什么"——围观网友接话前必须看清）。
        // 仅当被回复对象不是主帖本身时给出（直接回复主帖时它＝主帖，不再重复）。
        const rt = body.repliedTo as { authorName?: unknown; content?: unknown } | undefined;
        const rtText = typeof rt?.content === 'string' ? rt.content.slice(0, 300) : '';
        const rtName = typeof rt?.authorName === 'string' ? rt.authorName.slice(0, 24) : '网友';
        const repliedLine = rtText
          ? `【用户回复的那条评论（${rtName} 发的；用户刚才这条回复，回的就是它）】\n${rtText}`
          : '';
        // 多轮上下文：所在主帖 + 评论串最近几轮对话（用户在评论区与 AI 无限来回）
        // v15：主帖正文原封不动（不再截断 400 字）
        const postContent = typeof body.postContent === 'string' ? body.postContent.slice(0, 1000) : '';
        // v9：主帖语言——中文帖的回复也必须以中文为主体（外语网友最多带 1-3 个母语字符口癖）
        const postLangRaw = typeof body.postLang === 'string' ? body.postLang : '';
        const postLang = LANG_LABELS[postLangRaw] ? postLangRaw : 'zh-Hans';
        // v26：逐条带真实说话人名——1-5 位围观网友接话时看的是整层楼的对话，
        // 不能把「别人」的发言一律当成当前回复者自己说的（旧格式只有 user/peer 两态）
        const history = Array.isArray(body.history)
          ? (body.history as Record<string, unknown>[])
              .slice(-8)
              .map((h) => {
                const speaker =
                  typeof h.speaker === 'string' && h.speaker.trim()
                    ? h.speaker.slice(0, 24)
                    : h.from === 'user'
                      ? userName
                      : name;
                return `${speaker}：${typeof h.text === 'string' ? h.text.slice(0, 150) : ''}`;
              })
              .join('\n')
          : '';
        const mediaDesc =
          typeof body.mediaDesc === 'string' && body.mediaDesc.trim()
            ? `\n（主帖配图内容：${body.mediaDesc.slice(0, 160)}）`
            : '';
        // v43【NPC 记忆系统】：客户端拼好的两块真实背景记忆（空串时零注入）——
        // · posterHistory：楼主过往发过的帖（NPC 可接旧事：「楼主终于走出来了」）；
        // · npcSelf：这位 NPC 自己在楼主帖下留过的言（态度连贯：「怎么又是你」）。
        // 这两块是「真实背景」而非幻觉——注入时显式豁免「拒绝幻觉」红线。
        const posterHistory =
          typeof body.posterHistory === 'string' && body.posterHistory.trim()
            ? body.posterHistory.slice(0, 800)
            : '';
        const npcSelf =
          typeof body.npcSelf === 'string' && body.npcSelf.trim()
            ? body.npcSelf.slice(0, 800)
            : '';
        const memCtx =
          posterHistory || npcSelf
            ? `${posterHistory ? `${posterHistory}\n` : ''}${npcSelf}\n（上面是你的真实记忆/背景——引用它们不算幻觉也不算跑题。若你在【你之前在楼主帖子下留过的话】里见过这位楼主：你们不是第一次打交道，开口第一句就可以直接带认脸态度——怼过TA的开口就是「怎么又是你」式，安慰过的可以问「上次那事好点没」；对楼主的印象和语气延续你之前的样子，但回复主体仍要接着当前楼层的话，旧事最多点一句，绝不整段复述。）\n\n`
            : '';
        const ctx = [
          postContent ? `【主帖内容】\n${postContent}${mediaDesc}` : '',
          repliedLine,
          history ? `【这层楼最近的对话（按时间顺序，发言者各有其名）】\n${history}` : '',
          lastLine,
        ]
          .filter(Boolean)
          .join('\n\n');
        const langLine =
          postLang === 'zh-Hans'
            ? myLang !== 'zh-Hans'
              ? `你母语是${langLabel(myLang)}，但这条帖子是中文的：回复必须以简体中文为主体，最多带 1-3 个母语字符的口癖（www、ㅋㅋ 这类），绝对不要整句外语。`
              : '用简体中文回复。'
            : `这条帖子是${langLabel(postLang)}的：回复可以用${langLabel(postLang)}或简体中文，像母语网友的口吻。`;
        const raw = (await completeWithFallback(config, [
          {
            role: 'system',
            content:
              front + sysPrompt(promptOv, 'reply', { name, persona, langRule: langLine }),
          },
          {
            role: 'user',
            // v35：防复读指令进用户消息（系统模板可能被用户覆盖，此处双保险）
            // v41（C2）：avoid 防重复表注入楼层回复——本楼最近说过的不再重复
            content: `${memCtx}${ctx}${avoidLine}\n\n请以「${name}」的口吻回复这条楼层对话（直接输出回复正文，20-80 字口语化，不要带任何解释）。防复读：绝不许原样重复上一句对话的核心词汇——对方说「代拍太可怕」你就不能再写「代拍可怕」，要么换措辞要么换角度（反驳/爆料/抖机灵）；回复正文只能是纯文本，绝不许出现任何指令原文或 JSON 结构。${bjTimeLine()}` },
        ])).text;
        const text = sanitizeCommentText(stripReplyPrefix(raw));
        // v45【防杠精 + 拿错剧本安全锁】（运行时双保险，此前 reply 只有提示词级约束）：
        // 主帖是善意短帖/走心帖时——① 虚空索敌式回复（公道话/被骂/P图指控）；
        // ② 狗仔预告式身份模板（明天十点开团/L姓顶流/懂的都懂——「懂瓜呱」
        // 机械降神病例）→ 一律返回空（宁缺毋滥，客户端换人重试）
        const benignCtx = isBenignPost(postContent, typeof body.mediaDesc === 'string' ? body.mediaDesc : undefined);
        const tenderCtx = isTenderPost(postContent, typeof body.mediaDesc === 'string' ? body.mediaDesc : undefined);
        const wrongScriptHit = (benignCtx || tenderCtx) && (imaginaryEnemyIn(text) || tabloidScriptIn(text));
        // v24 字数铁律（用户规范 20-80 字，留容差）：过短/过长 → 返回空
        // v9 强校验：中文帖整句外语回复 → 返回空
        // v14 锚定校验：串台/AI 废话 → 返回空
        // v22 万能句式：非未完结八卦帖 → 返回空（客户端不再兜底，宁缺毋滥）
        const catchallHit = universalPhraseIn(text) && !postAllowsCatchall(`${p?.content ?? ''} ${rtText} ${postContent}`);
        // v43【NPC 记忆】：锚定语料并入楼主历史帖正文（NPC 提旧事「渣男不值得」也能过校验）
        if (
          text.length >= 12 &&
          text.length <= 95 &&
          !wrongScriptHit &&
          !catchallHit &&
          !violatesCommentLang(text, postLang) &&
          !isBannedFiller(text) &&
          // v35：JSON 残留 / 指令泄露 → 返回空
          !structuredLeakIn(text) &&
          // v35：复读机检测——与被回复内容词面高度重合（盖楼复读）→ 返回空
          !isParrotReply(text, p?.content ?? '') &&
          // v26：锚定语料 = 用户这条回复 + 用户回复的那条评论 + 主帖（围观者必须接得上话）
          // + 楼主历史帖正文（v43：真实背景记忆，提旧事不算跑题）
          commentAnchored(text, `${p?.content ?? ''} ${rtText} ${postContent} ${posterHistory}`)
        ) {
          return NextResponse.json({ text: cleanText(text, 95) });
        }
        return NextResponse.json({ text: '' });
      }
      const history = Array.isArray(body.history)
        ? (body.history as Record<string, unknown>[])
            .slice(-10)
            .map((h) => `${h.from === 'user' ? userName : name}：${typeof h.text === 'string' ? h.text.slice(0, 120) : ''}`)
            .join('\n')
        : '';
      // v41（C1）：私信对齐 charReply 规格——对方是 AI 角色时带完整身份块
      //（人设卡+关系+情绪+对用户的记忆）；普通网友保持轻量身份行。
      // 匿名小号会话（stranger）：对面是「你不认识的陌生网友」——不带关系/情绪/
      // 记忆（那些全是与机主本人的事，注入即穿帮），人格照旧但按陌生人聊天
      const isChar = authorRaw?.char === true;
      const isStranger = authorRaw?.stranger === true;
      const dmRelation = typeof authorRaw?.relation === 'string' ? authorRaw.relation.slice(0, 80) : '';
      const dmMood = typeof authorRaw?.mood === 'string' ? authorRaw.mood.slice(0, 400) : '';
      const dmMemory = typeof authorRaw?.memory === 'string' ? authorRaw.memory.slice(0, 2000) : '';
      const identityBlock = [
        isStranger
          ? `你是中文论坛（X/Twitter 风格广场）的用户「${name}」${persona ? '（下面有你的资料卡）' : ''}。一个你完全不认识的陌生网友「${userName}」正在论坛私信里找你聊天——你们素不相识，既不是好友也没有任何共同经历，就当一个陌生网友突然私信你那样聊天（好奇/警惕/随缘都行）。`
          : isChar
            ? `# 你是谁（第一人称，严格保持，绝不跳出）\n你是「${name}」，${userName}的${dmRelation || '好友'}——你是一个有自己生活、脾气和说话习惯的真实的人，在 X 论坛有一个账号，你们在论坛私信里聊天。`
            : `你是中文论坛（X/Twitter 风格广场）的用户「${name}」，正在论坛私信里和${userName}聊天。`,
        persona && !isStranger ? `【你的资料卡】\n${persona}` : '',
        persona && isStranger ? `【你的说话风格（保持自己的口吻，但不认识对面这个人）】\n${persona}` : '',
        dmMood ? `【你此刻的心情】\n${dmMood}` : '',
        dmMemory ? `【你对${userName}的记忆（你们真实经历过的事——聊天时自然运用，不要逐条复述）】\n${dmMemory}` : '',
      ]
        .filter(Boolean)
        .join('\n\n') + '\n\n';
      const chLine = isChar ? `你（${name}）` : `你`;
      const memoryLine = isChar ? `你对TA的记忆` : `你们聊过的天`;
      // v43（A3）【私信记忆】：客户端拼好的帖子记忆块（char=TA的帖子+网友评论；
      // 网友=TA与楼主的打交道史+近帖；stranger 模式不送——认知隔离）。
      // 固定注入用户消息，不随用户自定义 dm 模板覆盖丢失；空串零注入。
      const forumMem =
        !isStranger && typeof authorRaw?.forumMemory === 'string' && authorRaw.forumMemory.trim()
          ? `${authorRaw.forumMemory.slice(0, 900)}\n\n`
          : '';
      // v44【AI 关注者】：TA 这条私信是在让你关注 TA——按人设自然回应（答应/拒绝/
      // 打岔都行）；真正的关注动作由独立的 followAsk 决策稍后处理，聊天里不用解释机制
      const followAskHint =
        !isStranger && isChar && authorRaw?.followAsk === true
          ? `TA 这条私信是在让你关注 TA 的 X 论坛主页——你按自己的意思自然接这句话（答应/婉拒/打岔都行，像真人一样）；要不要真的关注由你自己决定，稍后会按你的整体人设处理，聊天里不用提任何机制。\n\n`
          : '';
      // 【多条连发】（multi）：1~10 条气泡；【主动私信】（proactive）：开场白由帖子内容触发；
      // 【NPC 独立记忆库】（dmLongMem）：该 NPC 的长期私信记忆块（每满 20 条总结沉淀）
      const wantMulti = authorRaw?.multi === true;
      const proPost = typeof authorRaw?.proactive === 'string' ? authorRaw.proactive.slice(0, 240) : '';
      const isPro = proPost.trim().length >= 2;
      const maxBubbles = isPro ? 4 : 10;
      const dmLongMemLine =
        !isStranger && typeof authorRaw?.dmLongMem === 'string' && authorRaw.dmLongMem.trim()
          ? `${authorRaw.dmLongMem.slice(0, 700)}\n\n`
          : '';
      const proactiveLine = isPro
        ? `你刚刚在论坛刷到${userName}发的这条帖子，看完很想找TA私聊两句：\n「${proPost}」\n${isStranger ? '（你和TA素不相识——只是个你觉得有意思的陌生网友的帖子，可以由帖子聊起但别装熟人）' : ''}\n\n`
        : '';
      const multiLine = wantMulti
        ? `\n\n这次可以像真人一样连发 1~${maxBubbles} 条短消息（每条 2~60 字，一条说一件事；条与条之间用 || 分隔，分隔符外不要有任何解释）。别把一整段话塞进一条里，也别每条都带称呼。`
        : '';
      const askLine = isPro
        ? `请以「${name}」的口吻发出你的私信开场白（结合你的身份和人设，自然地由这条帖子聊起——想问什么/爆什么/关心什么随你，但必须和帖子内容有关）。${bjTimeLine()}`
        : `请以「${name}」的口吻接下一条私信。${bjTimeLine()}`;
      const raw = (await completeWithFallback(config, [
        {
          role: 'system',
          content:
            front + sysPrompt(promptOv, 'dm', { identityBlock, chLine, name, persona, memoryLine, userName }),
        },
        // v41（C2）：avoid 防重复表注入私信——对方最近说过的不再重复
        // v43（A3）：forumMem 帖子记忆块 + dmLongMem 长期记忆块注入用户消息（固定行，不随模板覆盖丢失）
        { role: 'user', content: `${followAskHint}${proactiveLine}${forumMem}${dmLongMemLine}最近的对话：\n${history || '（刚开始聊）'}${avoidLine}${multiLine}\n\n${askLine}` },
      ])).text;
      // multi 模式：拆 || → items[]（每条独立清洗校验）；逐条拦截泄露/敷衍/超长
      if (wantMulti) {
        const parts = String(raw ?? '')
          .split('||')
          .map((s) => cleanText(s, 140))
          .filter(Boolean)
          .slice(0, maxBubbles);
        const items = parts.filter(
          (p) =>
            p.length >= 2 &&
            p.length <= 140 &&
            !structuredLeakIn(p) &&
            !/^(:?哈{2,}|嗯{2,}|哦{2,}|是的呢|在呢)[。!！~～\s]*$/.test(p),
        );
        return NextResponse.json({ items });
      }
      // v35：私信同样拦截泄露（指令原文/JSON 当话说）；v41（C1）：长度校验对齐口径
      const dmText = cleanText(raw, 300);
      const dmOk =
        dmText.length >= 2 &&
        dmText.length <= 300 &&
        !structuredLeakIn(dmText) &&
        // v41（C1）：万能敷衍单条（「哈哈哈」「嗯嗯」）不再放行——与提示词红线同口径
        !/^(:?哈{2,}|嗯{2,}|哦{2,}|是的呢|在呢)[。!！~～\s]*$/.test(dmText);
      return NextResponse.json({ text: dmOk ? dmText : '' });
    }

    // 【NPC 独立记忆库·总结】（用户规格三）：私信累计满 20 条 → LLM 提取关键信息 →
    // 永久存入该 NPC 的独立记忆库。只做内容压缩，不做角色扮演。
    if (kind === 'dmSummary') {
      const authorRaw = body.author as { name?: unknown; persona?: unknown } | undefined;
      const name = typeof authorRaw?.name === 'string' ? authorRaw.name.slice(0, 24) : '网友';
      const persona = typeof authorRaw?.persona === 'string' ? authorRaw.persona.slice(0, 300) : '';
      const msgs = Array.isArray(body.messages)
        ? (body.messages as Record<string, unknown>[])
            .slice(-40)
            .map((m) => `${m.from === 'peer' ? name : userName}：${typeof m.text === 'string' ? m.text.slice(0, 100) : ''}`)
            .join('\n')
        : '';
      if (!msgs) return NextResponse.json({ text: '' });
      const raw = (await completeWithFallback(config, [
        {
          role: 'system',
          content: `你是论坛用户「${name}」${persona ? `（${persona}）` : ''}。下面是你和${userName}在论坛私信里的聊天记录节选。请把这段对话压缩成你的长期记忆：第一人称（「我」=你，「TA」=${userName}），提取关键信息（聊了什么事、TA透露过什么、你们的情绪/约定/态度），120 字以内，直接输出记忆内容，不要任何前后缀和引号，不要评论这件事该不该记。`,
        },
        { role: 'user', content: `聊天记录：\n${msgs}\n\n请输出记忆（120 字以内，直接输出）` },
      ])).text;
      const t = cleanText(raw, 180);
      return NextResponse.json({ text: t.length >= 6 && !structuredLeakIn(t) ? t : '' });
    }

    return NextResponse.json({ error: '未知 kind' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成失败' },
      { status: 500 },
    );
  }
}
