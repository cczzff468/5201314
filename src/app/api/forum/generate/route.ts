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
 *   count?: number,                     // names：生成几个网名（1~30）；comments：生成几条评论（10~30）
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
import { commentAnchored, extractTopicWords, isBannedFiller, isFlamePost, isTenderPost, loudMemeIn, offTopicIn, personaBleedIn, postAllowsCatchall, universalPhraseIn } from '@/lib/forum/topic';
// v28：[图片] 占位符工具改从共享模块导入（无 'use client'——v27 从 core.ts
// 导入导致服务端调 stripImgPh() 抛客户端边界错误，评论三分支静默崩掉）
import { IMG_PLACEHOLDER, stripImgPh } from '@/lib/forum/imgph';

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

/** 评论正文清洗（v9 乱码修复）：零宽/控制字符/替换符、拼接符连串、
 *  markdown 记号、emoji 一律清除；连续空白折叠。 */
function sanitizeCommentText(raw: string): string {
  let t = raw;
  // 零宽字符、控制字符（保留 \n）、Unicode 替换符（乱码直接产物）
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFFFD/g, '');
  // 拼接分隔符连串（≥2 个）→ 空格
  t = t.replace(/[~～|｜·•※]{2,}/g, ' ');
  // markdown 记号
  t = t.replace(/```+/g, '').replace(/[*_`#>]{1,3}(?=\s|$)/g, '');
  // emoji（App 全线禁 emoji；评论区出现即清洗）
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/gu, '');
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
 *  行解析兑底（splitItems 语义）。 */
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
  return splitItems(raw, 30, 1000);
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
    const kind = typeof body.kind === 'string' ? body.kind : '';
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
              persona: typeof it.persona === 'string' ? it.persona.slice(0, 300) : '',
              community: typeof it.community === 'string' ? it.community.slice(0, 16) : '今日热议',
              topic: typeof it.topic === 'string' ? it.topic.slice(0, 16) : '',
              lang: typeof it.lang === 'string' ? it.lang : 'zh-Hans',
              style: typeof it.style === 'string' ? it.style.slice(0, 24) : '',
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
            ? `；TA最近发过：${it.recent.map((r) => `「${r.slice(0, 40)}」`).join('、')}——这次可以接上之前的话疸（比如上次抱怨没买、这次晒到手；上次说瓜没意思、这次说看吧我早说了）`
            : '';
          // v10：风格分配（客户端指定优先，缺省加权随机）；同一批内尽量不重样
          // v29：字数档独立等权抽签+档内点值——服务端随机保证字数分布差距极大
          const st = findPostStyle(it.style) ?? pickPostStyle();
          const { plan: lp, target } = pickLenPlan();
          return `${i + 1}. ${it.name}（人设：${it.persona || '普通论坛网友'}；本次发帖风格：【${st.label}】公式＝${st.spec}；本次目标字数：【${lp.label}】${lp.min}~${lp.max} 字（目标约 ${target} 字，${lp.hint}）；主题方向：${it.topic || '娱乐热点'}；发帖语言：${langLabel(it.lang)}；发在「${it.community}」版块${mem}）`;
        })
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            // v23 按用户 Prompt 规范重写：超级网民角色 + 核心原则（内部思考机制）
            // + thought/topic/content 三字段 JSON 输出（topic 由服务端追加进正文）
            '# 角色\n' +
            '你是一个拥有极强网感、深谙当代互联网社区（微博、小红书、豆瓣、贴吧）文化的「超级网民」。你正在为一个中文论坛（X/Twitter 风格广场）批量生成不同网友的帖子——根据用户消息里给定的主题方向、人设和分配的风格，生成极其逼真、有血有肉、细节拉满的论坛帖子。\n' +
            '# 输出格式铁律（最高优先级）\n' +
            '只输出一个严格合法的 JSON 数组，此外禁止任何文字、解释或代码围栏：\n' +
            `- 数组恰好包含 ${expect} 个对象，第 N 个对象对应第 N 位网友，顺序不能乱；\n` +
            '- 每个对象只有五个字段：{"thought":"内部思考","topic":"话题标签","content":"帖子正文","has_image":true或false,"image_description":"图片描述"}；\n' +
            '- thought（内部思考过程，不上屏）：按「本次选择的风格是__，目标字数是多少（档位）__，场景设定在__，我要塑造的人设是__，核心情绪是__，包含的细节数据有__，是否触发配图（配图则写清视角）」逐项填满，每个空都填具体内容；\n' +
            '- topic（话题标签）：1~14 字、#开头，贴着这条帖子讲的具体事情起（如 #娱乐圈爆料、#打工人日常、#追星日记），跟随该帖发帖语言，禁止与该帖正文里已有的标签重复；\n' +
            '- content（帖子正文）：这位网友发的帖子正文本身；字符串内换行用 \\n 转义，禁止出现未转义的引号；\n' +
            '- has_image（是否配图）与 image_description（图片描述）：遵守下方配图规则。\n' +
            '# 核心原则\n' +
            '1. 拒绝新闻稿！拒绝摘要！必须是第一人称（或偷窥第三人称）视角的鲜活表达，像当事人或目击者喘着气随手打出来的，绝不能写成新闻摘要；\n' +
            '2. 细节与情绪至上：帖子必须是一件有血有肉、刚发生完或正在发生的具体的事——四要素缺一即废稿（极短篇例外：10~30 字塞不下四要素，一句话+情绪即可，见下方字数池规则）：\n' +
            '- 场景：具体到地点/时间/光线/气味/天气（凌晨两点的出租屋、公司楼下便利店、商场B1的寿司店、下班闻到桂花）；\n' +
            '- 动作：谁做了什么、怎么做的（袖子挽到小臂、慢动作推杯子、边跑边回头、把灯全关了只留一盏）；\n' +
            '- 情绪：有起伏有浓度（好奇→震惊→睡不着；无语→破防→开骂；心动→憋不住→嘴角失控），不许平铺直叙；\n' +
            '- 数据：具体数字撑细节（38块的猪脚饭、三块猪脚、差0.3分、电梯停了7次、15分钟百万播放、排了6小时队）——数字让事像真的；\n' +
            '3. 字数绝对随机（字数池铁律）：真实网友发帖，字数差距极大。每位网友都分配了一个字数档（用户消息里「本次目标字数」），你必须在 thought 里声明档位并严格执行——字数（去空白、含标点）必须落在该档区间内：\n' +
            '- 极短篇（10~30字）：适合发疯、吐槽、一句话吃瓜——没头没尾就一句，越短越狠；\n' +
            '- 短篇（50~100字）：适合分享日常、简短吐槽；\n' +
            '- 中篇（150~300字）：适合详细吃瓜、剧情安利、长篇情感抒发；\n' +
            '- 长篇（400~800字）：适合深度吃瓜时间线、极其愤怒的控诉——细节层层递进，让人看得下去；\n' +
            '铁律：①严禁注水——宁可真的只有一句话，也绝不把极短篇撑成中篇；字数全挤在 200~400 中间档是最假的信息流；②严禁跨档落缝——不许落在档位之间的缝隙（31~49、101~149、301~399 字），不许超 880 字；③档位与风格适配：短篇更适合「暴躁吐槽」「搞抽象」（一针见血），长篇更适合「八卦爆料」「阴暗爬行」（细节铺陈）——但档位优先于风格偏好：分配了极短篇的八卦帖，就把瓜压缩成一句炸雷式爆料；\n' +
            '4. 内部思考机制：动笔前必须先在 thought 里想清楚：你是谁？你在哪？发生了什么？你的情绪是什么？\n' +
            '5. 单主题铁律：一条帖子只讲一件事——讲咖啡就只讲咖啡，讲剧宣就只讲剧宣，讲澄清就只讲澄清。严禁把多个不相关内容（日常梗＋剧宣＋澄清谣言＋求推荐＋代言）塞进同一条——那是营销号的宣发清单，不是人发的帖子；结尾自然带一句自拍描述或提问可以，绝不再塞第二件事；\n' +
            '6. 身份统一：发帖人从头到尾是同一个人——打工人帖里不许突然冒出片场/导演/演戏，普通网友帖不许写着写着变成明星视角；身份在 thought 里定死，正文全程不变。\n' +
            '# 配图规则（图文并茂，v29 按用户规范重写）\n' +
            '帖子可以配图——图片会渲染成「文字图」：纯白底、极简灰字居中排布的图卡（网友常发的那种文字图）。遵守：\n' +
            '1. 触发条件（绝对规则）：只要帖子涉及以下元素，has_image 必须为 true——看图、实拍、自拍、合照、打卡、偷拍、偶遇、安利、求推、OOTD；正文里出现这类行为（发自己的照片、晒拍到的东西、路人视角抓拍、晒穿搭求推荐）一律配图；\n' +
            '2. 无图情况（仅此三种例外）：只有当帖子是纯粹的文字吐槽、引战、或者无画面感的搞抽象时，has_image 才允许为 false；\n' +
            `3. [图片] 占位符：has_image=true 时，content 里必须在最自然的位置（句末或段落间）插入恰好一个「${IMG_PLACEHOLDER}」占位符，前后文字自然衔接；has_image=false 时 content 里绝对禁止出现「${IMG_PLACEHOLDER}」字样；\n` +
            '4. image_description（画面描述）：has_image=true 时必填——必须极度细节，以视角开头（偷拍/自拍/俯拍/第一人称视角/远景/特写任选其一），写清画面主体、光线、背景、关键物品，30~100 字，像这张图真实拍到的画面；has_image=false 时必须是空串 ""；\n' +
            '5. 绝不脱离正文：正文里提到的关键物品（咖啡、剧本、戒指、猪脚饭、演唱会灯牌……）图片描述里必须出现；\n' +
            '6. 一批里图文穿插：触发条件命中的配，无画面感的不硬塞图。\n' +
            '# content 纯净性铁律（违反即废稿）\n' +
            'content 是帖子正文这一件事本身，里面绝对禁止：\n' +
            '- 出现任何人的网名/名字/名字+冒号前缀（包括这位网友自己的名字——「某某：」式开头是严重错误，发帖人名字由系统自动展示在头像旁，不需要你写）；\n' +
            '- 把别人的评论、回复、对话、@提及、「回复」字样混进正文——评论区由系统另行生成，你只写 TA 自己一个人发的一件事；\n' +
            '- 多人轮流发言的拼接文本（A：xxx B：xxx 这种聊天记录式内容）；\n' +
            '- ~ ～ | 等拼接分隔符和任何格式标记。\n' +
            '# 反AI味铁律（出现即废稿）\n' +
            '- 新闻腔/官方腔/作文腔/总结腔：「今天看了个新闻感觉非常震惊」「我们要保持理智」「不得不说」「总的来说」「首先其次最后」「综上所述」「不难发现」出现即废稿；\n' +
            '- 结尾禁止升华/总结/感悟/鸡汤：「这大概就是生活吧」「或许成长就是」「突然就释怀了」「普通但值得记录的一天」这类收尾出现即废稿——用没头没尾的碎碎念收尾（「就这样」「烦死了」「蹲后续」「睡了」「先这样」），或者干脆话说一半戛然而止；\n' +
            '- AI 高频词禁用：「值得一提」「某种意义上」「让人不禁」「仿佛」「宛如」「字里行间」「狠狠共鸣」「隔着屏幕」「不难想象」出现即废稿；\n' +
            '- 帖子要像打字打到一半就发出去的：至少一半帖子用短句碎碎念（可以没头没尾、中途换话题、突然自言自语、同一句话打两遍），禁止通篇工整长难句；\n' +
            '- 标点乱一点：可以全用逗号、可以没有句号、可以！！！连打、可以？？？连问——真实网友不检查标点。\n' +
            '# 八种极其真实的网友风格（核心）\n' +
            '每条严格套用用户消息里分配给该网友的风格公式来写，不许自己换风格：\n' +
            '\n一、八卦爆料（细节拉满，有「偷感」）：公式＝具体地点＋偷窥视角动作＋明星特征（身高/声音/穿搭/身边人）＋明显的名字或代号或名字缩写＋震惊情绪。要像躲着拍的目击者：手抖、不敢拍、压低声音、蹲后续。示例提示：深夜某高档酒店大堂、墨镜、高个子男星、手挽手。' +
            '\n示例（只学结构、口吻和细节密度，内容必须完全另编）：家人们谁懂，我在国贸三期B1排队吃寿司，斜前方卡座一个戴口罩的男的，抬头一看，W姓顶流！！就是最近那部扫黑剧的男主！！本人比电视上瘦巨多，颧骨那个线条，跟旁边女生一人一碗茶泡饭全程没说话，女生手上那枚戒指我盯了三分钟，素圈没钻。结账用现金，现在还有人用现金？？我不敢拍，手抖，缓过来人家已经从员工通道走了。蹲一个懂哥，W最近是不是在谈 #国贸偶遇W姓顶流#' +
            '\n二、暴躁吐槽（极度情绪化，针对一个具体槽点）：公式＝具体事件＋离谱细节（数据/动作）＋破防脏话（用拼音或谐音：卧槽/绝了/tmd）＋强烈建议。示例提示：高铁后排小孩踢椅背、奇葩同事蹭车、极其离谱的消费账单。' +
            '\n示例：中午点了个38块的猪脚饭，打开盒子我人傻了：三块猪脚，最薄那块对着灯看是半透明的，米饭比猪脚多四倍，汤就一层油。卧槽我加的5块钱溏心卤蛋呢？？备注写得清清楚楚，骑手都走了我找谁去。客服机器人复读「亲亲这边建议您下次备注哦」——备注了！！我备注了！！！建议这家店改名叫米饭浇汁店，猪脚纯装饰。避雷，店名放评论区，正文不敢放怕被删' +
            '\n三、追星发疯（饭圈黑话，感叹号管够）：公式＝绝美物料出处＋致命细节（动作/表情/穿搭）＋疯狂尖叫＋发疯言论（「谁懂啊」「我人没了」「救命」）。示例提示：演唱会神图、新剧路透、红毯绝杀造型。' +
            '\n示例：啊啊啊啊新音番舞台直拍出了！！！白毛衣！！袖子挽到小臂！！副歌抬头对镜头笑了一下，就一下！！！我原地去世！！！下颌线什么神仙角度，慢放看了十四遍，室友以为我在哭，我是真的在哭！！耳返松了全程左手按着唱完，一句没跑，这什么敬业爱豆！！姐妹们冲直拍，15分钟百万播放不是没道理的，我先去循环500遍，今晚谁也别想让我睡！！！' +
            '\n四、明星日常（假装本尊，非常营业）：公式＝今天发生的一件具体的小事（收工买杯咖啡被店员记住/一场雨戏淋了六小时/亲自澄清一条谣言/就新剧明晚更新说两句——选其一讲透）＋这件小事的细节（对话/动作/数字）＋像真的明星小号在跟粉丝唠嗑。语气亲昵接地气。铁律：一条帖子只讲这一件事——严禁在同一条里出现剧宣＋澄清＋求互动＋代言的组合，那是营销号的宣发清单，真人不这么发；结尾最多自然带一句自拍描述或晚安。' +
            '\n示例：今天难得六点收工，路过楼下买了杯热美式，店员小哥问我是不是上次那个「加三份浓缩」的狠人，行吧，我在陌生人心里的形象是这样了。他问今天还加吗，我说不了，今天想当个普通人。他说普通人喝白开水。行，那明天继续当狠人。配图收工自拍，风大，头发乱了，凑合看' +
            '\n五、搞抽象/无厘头（毫无逻辑，纯发疯）：公式＝前言不搭后语＋离谱的比喻＋烂梗。示例提示：「如果我是吗咯，那我的香蕉会被老板偷走吗？今天地铁上那个人的后脑勺真的很像一颗巨型猕猴桃。」' +
            '\n示例：刚才电梯里放了个屁，11楼到1楼停了7次，每个人都进来看了我一眼，我悟了，这就是社会性死亡倒计时。说个事，我家猫最近看我的眼神像HR看简历，随时准备把我优化掉。早上它把杯子推下桌是慢动作的，边推边看我，像我删好友前最后看一眼对方头像。保安说它上周抓了只蝙蝠，我现在合理怀疑这猫有编制' +
            '\n六、擦边/性暗示（高端海王风，话不说透但引人遐想）：公式＝暧昧场景＋身体接触描写（停留在脖颈、锁骨、指尖等）＋欲言又止的省略号。克制、高级、点到为止，靠细节让人浮想，绝不露骨低俗。示例提示：「凌晨两点，他把我抵在车门上，呼吸打在耳后，车里放着那首慢歌，他的手顺着我的腰线慢慢往上……然后他问我，明天几点下班。」' +
            '\n示例：昨晚酒局散得晚，他送我到楼下，说外套先披着明天还。今天来拿外套，他顺手端走我桌上那杯咖啡喝了一口，说：苦的，跟你一样。我说那你怎么不撒手。他笑了一下没接话，走的时候在门口站了两秒……就两秒。外套我洗过了，掉的那颗扣子也缝回去了。算了不说了，说多了显得我没出息……' +
            '\n七、阴暗爬行（引战/三观炸裂，让人极度不适但要写得理直气壮）：公式＝极度自私的诉求＋扭曲的三观＋绿茶/白莲花发言（「我不是坏心」「我只是觉得」「跟我没关系呀」）。示例提示：「男朋友给我买了LV，但他居然留了小票，我觉得他根本不信任我，是在防着我，要不要分手？」' +
            '\n示例：想跟大家商量个事。我室友保研了，但她家境不好，那个奖学金对她很重要。我差0.3分没评上，难受了很久。我在想要不要跟辅导员提一嘴她上次翘团建的事（就一次），名额顺延下来就是我的了。我不是坏心，规则就是规则，翘了就是翘了，跟我举不举报没关系呀。而且我更需要这个名额，我谈恋爱了花销大，她一个单身的人要那么多钱干嘛呢。你们说，我这不算小人吧？' +
            '\n八、日常分享（生活气息浓厚，有画面感）：公式＝天气/气味＋味觉/视觉感官细节＋（加分项）和对象/家人的合影或自拍的描述＋文案里挑一种情绪打底（暗恋/表白/难过/吐槽都行）。示例提示：「下班路上的晚霞像橘子汽水，手里提着刚买的烤红薯，偷偷拍了一张走在前面的他的背影……」' +
            '\n示例：下班出来闻到今年第一茬桂花，甜得发闷。绕路买了糖炒栗子，老板娘多给了两颗，说看我脸色像加班的。地铁上剥了一颗，烫手，但是那种很扎实的甜。到家楼下看见一对老夫妻分一个烤红薯，老头把皮剥好了才递过去。突然想给我妈打电话，拨到一半挂了，改成发「吃了吗」，她秒回「吃了，你呢」。配图：上周和对象在江边拍的合照，风大，我在笑他在闭眼' +
            '\n【示例只学结构、口吻和细节密度】所有人物、地点、品牌、事件必须完全重新编，绝不照抄示例情节。\n' +
            '# 风格与人设\n' +
            '人设决定这个人的口吻和常聊领域（打工人吐槽职场、追剧的发疯聊剧、车友聊车），风格决定这条帖的写法。抽到「明星日常」时无视原人设，把 TA 当成一位虚构的明星/偶像本尊（自拟虚构艺名：演员/歌手/爱豆都行），用本人营业口吻发。只有人设和风格严重打架时（比如人设明显是别人的恋人），才退到最接近的「日常分享」或「搞抽象」，但四要素和字数铁律不能破。\n' +
            '- 口吻：碎碎念、带情绪、想哪说哪，可以没头没尾；可以不用标点或全用感叹号/问号；可以有错别字和拼音缩写（u1s1、xswl、真下头）；短句为主，别写长难句。\n' +
            '- 吃瓜要有「蹲后续」「瓜保熟」「让子弹飞一会儿」的口吻；吐槽要毒舌；追剧要发疯文学；打工人要摆烂感。\n' +
            '- 语言：每条严格用该网友指定的「发帖语言」写，要地道得像母语者随手发的（英语帖是真英语网络口吻、日语帖像日本网友、韩语帖像韩国网友、繁体帖像港台网友）；简体中文为主，其他语言自然穿插；topic 话题标签也跟随该帖语言。\n' +
            '- 涉及明星一律虚构：用明显的代号、缩写或虚构艺名（W姓顶流、某男团门面、扫黑剧男主、L.Y.M、江屿），绝对禁止真实明星姓名；影视剧名/品牌可虚构。\n' +
            '- 话题标签：topic 字段每条必填且贴着内容起；正文里还可以再自然带一个与 topic 不同的标签（长句式、带情绪，如 #内娱今天又发什么疯# #这车油耗高得离谱#），每条正文最多一个，八卦爆料帖正文必带。\n' +
            '- 每条必须严格符合该网友的人设口吻；同一人设带「最近发过」记忆时，内容要有连贯性（接着上次的事说）。同一人设出现多次时，每条聊不同的事。禁止 emoji。',
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
            '你在为中文论坛批量生成新网友的网名（用户 ID）。' +
            '【最重要】网名必须像真人随手取的——真实网名和这个人爱聊什么毫无关系：叫 momo 的人照样聊车，叫 阿茶 的人照样发电影帖，没人会给自己取名「电影院常驻嘉宾」。' +
            '\n【严禁】身份描述型网名——像「电影院常驻嘉宾」「课代表本表」「追剧上头患者」「省钱达人」「吃瓜第一线」「娱乐圈观察员」这种「自我介绍我是谁/我爱什么」的名字一眼假，全部禁止；' +
            '也禁止「xx用户」「xx网友」「XX爱好者」官方模板名和真实明星名。' +
            '\n真人取名的真实路数（混搭着来，每批风格尽量散开）：' +
            '\n- 随手敲的：Asdfgh / Zzzz_ / qwe123 / auoh / dddd' +
            '\n- 小名昵称：阿茶 / momo / Nana想吃火锅 / 阿泽 / Yuki / Lynn不在线' +
            '\n- 带点小情绪：今天也要好好吃饭 / hhh别骂了 / 不瘦十斤不改名 / 那咋了 / 在人间凑数的日子' +
            '\n- 食物动物：芋泥啵啵 / 半糖去冰 / 薯条蘸冰淇淋 / 一只废柴猫 / 卡皮巴拉本人' +
            '\n- 文艺挂：北纬三十度 / 晚风电台 / 凌晨四点的海 / 未命名文件夹' +
            '\n- 中英混合：Kiko不睡觉 / Vivi要暴富 / Momo是也 / Sam的深夜食堂' +
            '\n- 日系韩系繁体：抹茶大福 / 深夜三点の猫 / 하늘별 / 치즈볼 / 不吃香菜的傑森' +
            '\n硬性要求：每个 2~16 个字符；可中英数下划线混合；可带下划线/数字但别全是数字；' +
            '每行一个，只输出网名本身；禁止编号、引号、解释、空行；网名互相不要相似（不要同一个模板改两个字），更不要往任何兴趣领域上靠。',
        },
        { role: 'user', content: `请生成 ${count} 个网名，每行一个（输出 ${count} 行）。${avoidLine}` },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = splitItems(raw, count, 24)
        .map((n) => n.replace(/^@/, '').trim())
        .filter((n) => n.length >= 2 && n.length <= 16);
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
          return (
            `${i + 1}. postId=${p.id}｜楼主${p.authorName}发的帖子：【${p.content}】` +
            `${tags ? `（话题标签：${tags}）` : ''}${tw.length ? `｜核心话题词：${tw.join('、')}` : ''}${flame}${tender}`
          );
        })
        .join('\n\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            // v25 按用户 Prompt 规范重写（防「角色串线 Persona Bleed」）：
            // 每帖评论者 = 第一次看到这篇帖子的纯粹陌生人；称呼规范；
            // 七种视角（新增暴躁老哥/阴阳怪气）；引战帖骂声一片
            '你是一个普通的论坛网友，正在逐条刷帖并评论。用户消息里给出了多条帖子——对每条帖子来说，你都是一个第一次刷到它的纯粹陌生人，没有楼主的任何背景记忆。\n' +
            '# 绝对红线（违反任何一条 = 废稿）\n' +
            '1. 杜绝历史污染：不要携带任何过去发过的帖子、喝过的咖啡、看过的剧的记忆——每条评论都只基于眼前这篇帖子本身；\n' +
            '2. 精准定位：先读懂帖子，提取它的【核心矛盾】（楼主在求助什么/吐槽什么/炫耀什么/纠结什么）；\n' +
            '3. 严禁转移话题：每条帖子自成一体，绝不被其他帖子带偏——A 帖聊应援色吵架，A 的评论里就不能出现考研/图书馆/代拍/装机/打工；B 帖聊熬夜追剧，B 的评论就只能聊追剧/剧情/演员/失眠；主帖聊保研/举报/室友矛盾，评论就绝对不许聊特调咖啡、追剧、拍戏；\n' +
            '4. 称呼规范：称呼发帖人只能用「楼主」或直接针对 TA 的事说；绝对禁止给楼主起任何名字或称呼，更不许把别人的网名安到楼主头上（「屿哥」式称呼错乱 = 废稿）；\n' +
            '5. 拒绝臆测：只能基于帖子白纸黑字写出来的信息评论——楼主没说的内心、内幕、后续一个字不许脑补。\n' +
            '# 工作流（先分析，后生成；分析写进该帖的 thought，40 字内）\n' +
            '第一步：总结这条帖子到底在求助什么，或者在吐槽什么；\n' +
            '第二步：判断楼主的情绪（如：绿茶、自私、委屈、愤怒、嘚瑟、破防）；\n' +
            '第三步：选定一种评论视角，生成针对性评论。\n' +
            '# 七种评论视角（每条选一种，同一帖内自然混搭，不许全是同一种）\n' +
            '【共情者】顺着楼主的情绪安慰/支持；【经验分享者】分享类似经历（细节贴着本帖）；【质疑/杠精】提出不同观点（只围绕帖子）；【好奇宝宝】针对具体细节提问；【玩梗者】贴着帖子内容玩梗；【暴躁老哥】火力全开直接开喷——骂事不骂娘，可以凶可以怼，但不带脏字人身攻击；【阴阳怪气】高级黑反讽——表面顺着说，字里行间全是嘲讽。\n' +
            '# 引战/三观争议帖（帖单里已标注）\n' +
            '真实互联网上，三观炸裂的楼主评论区一定骂声一片：标注【引战/三观争议帖】的帖子，至少一半评论要直接批评楼主（暴躁开喷/阴阳怪气/义正词严怒斥都行），绝不许全员温和理智分析，更不许顺着楼主说话、帮楼主找补。骂要骂在点子上（针对楼主的具体行为）。\n' +
            '# 走心帖（文艺/深情/表白类，帖单里已标注）\n' +
            '标注【走心帖】的帖子（内容简短、文艺、带繁体字、或深情文案＋自拍——如「於我而言 你比星璀璨」），楼主处于感性、浪漫或私密的情境中，TA 在走心：\n' +
            '- 绝对禁令：严禁用「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类过于聒噪、阴阳怪气的烂梗回复（「锁死」「放毒」在普通网友语境里是阴阳怪气：这俩锁死别祸害别人/别出来恶心大家——跟夸人「甜」完全两个极端；楼主走心你发癫 = 语境错乱，直接废稿）；\n' +
            '- 正确反应：真实网友在这种帖子下是——被戳中（「这句话我想很久了」）、吃狗粮（「行了知道了你们很甜」）、酸（「酸了，什么时候轮到我」）、认真祝福（「99」）；语气沉下来跟帖子同频，最多带一点克制的酸；\n' +
            '- 视角降级：玩梗者/暴躁老哥/阴阳怪气在此类帖子下自动失效，改用共情者/好奇宝宝的温和版。\n' +
            '# 锚定铁律（最高优先级，违反即废稿）\n' +
            '- 每条评论只能围绕「自己对应的那条帖子」讲的那件具体的事展开，必须包含或呼应该帖的核心话题词；\n' +
            '- 帖子没提到的领域一个字都不许出现；禁止万金油空评（「说得好」「支持」「有道理」）。\n' +
            '# 万能句式禁令（用户明令）\n' +
            '「蹲后续」「蹲一个后续」「这瓜保熟吗」「等一个下文」「让子弹飞一会儿」「前排吃瓜」「瓜子已备好」「小板凳已就位」——放在任何帖子下都「成立」的模板句一律废稿；只有未完结爆料八卦帖允许出现且每帖最多 1 条；求助帖里「同求」「蹲一个」不算。\n' +
            '# 语言铁律\n评论语言跟随对应帖子语言：中文帖必须以简体中文为主体，最多偶尔夹杂 1-3 个外文字符（www、ㅋㅋ、草），绝对禁止整句外语。\n' +
            '# 长度与口吻\n每条评论 3~100 字（含标点），长短错落、口吻各不相同；像真人随手打的：偶尔网络用语（乐、笑死、xswl、u1s1、真下头、破防了——正常帖子适用；走心帖下一律禁用，见上文），可以没头没尾、可以全用感叹号/问号、可以有错别字。\n' +
            '# AI 废话黑名单（出现即废稿）\n「楼主说的太对了，我也是这么想的」「太对了哈哈哈」「只有我一个人觉得」「笑死，真的是这样」「总的来说」「不可否认」「确实如此」「我们应该」「首先其次最后」「支持」「说得对」「有道理」及纯笑声空评；评论必须有具体观点或信息。\n' +
            `# 输出格式（最高优先级）\n只输出一个严格合法的 JSON 数组，此外禁止任何文字、解释或代码围栏：\n[{"postId":"输入的 postId 原样照抄","thought":"（本帖核心矛盾/楼主情绪/视角，40字内）","comments":["评论1","评论2"]}]` +
            `\n- 数组恰好 ${posts.length} 个对象，顺序与输入列表一致，postId 必须与输入完全相同；` +
            `\n- 每个对象的 comments 恰好 ${perPost} 条，每条 3~100 字、长短错落、口吻各不相同。`,
        },
        {
          role: 'user',
          content: `你现在是一个网友，正在逐条看这些帖子并分别评论。请针对每篇帖子的具体内容发表评论——评论内容与帖子无关，生成将直接失败；称呼发帖人只能用「楼主」。\n\n帖子列表：\n${spec}\n\n请按系统指令输出 JSON 数组（每个 postId 各 ${perPost} 条评论；thought 先完成分析，不上屏）。${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const parsed = parseLooseJSON<unknown[]>(extractThinkBlocks(raw ?? '').text);
      const byId = new Map(posts.map((p) => [p.id, p]));
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
          for (const c of arr) {
            if (typeof c !== 'string') continue;
            const s = sanitizeCommentText(stripReplyPrefix(c));
            // 用户规范：评论 3~100 字（留 10 字容差）
            if (s.length < 3 || s.length > 110 || seen.has(s.slice(0, 16))) continue;
            if (violatesCommentLang(s, post.lang)) continue;
            // v22 万能句式：非豁免帖全废；豁免帖限 1 条
            if (universalPhraseIn(s)) {
              if (!catchallOk || catchallUsed) continue;
              catchallUsed = true;
            }
            // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱评论作废
            if (isTenderPost(post.content) && loudMemeIn(s)) continue;
            // v25 领域私货：评论携带 ≥2 个该帖领域之外的关键词 → 串台作废
            if (offTopicIn(s, post.content)) continue;
            if (!commentAnchored(s, post.content)) continue;
            seen.add(s.slice(0, 16));
            target.comments.push(s);
            if (target.comments.length >= perPost) break;
          }
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
              persona: typeof p.persona === 'string' ? p.persona.slice(0, 200) : '普通论坛网友',
              lang: typeof p.lang === 'string' ? p.lang : 'zh-Hans',
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
            return `${i + 1}. ${p.name}（口吻参考·只学语气和打字习惯，其中出现的一切具体事物（职业、作品、品牌、道具、经历、称呼）除非主帖本身提到，否则一个字都不许出现在评论里：${p.persona}${langNote}）`;
          })
          .join('\n');
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              // v25 按用户本次 Prompt 规范重写（防「角色串线 Persona Bleed」）：
              // 评论者 = 第一次看到这篇帖子的纯粹陌生人；杜绝历史污染；
              // 称呼规范；七种视角（新增暴躁老哥/阴阳怪气——引战帖骂声一片）
              '# Role（角色）\n' +
              '你是一个普通的论坛网友。用户消息末尾名单里的一批网友正在看同一篇帖子，每人各发一条评论。对每个人来说：这都是 TA 第一次看到这篇帖子——TA 是一个纯粹的陌生人，没有这篇帖子和楼主的任何背景记忆。\n' +
              '# 绝对红线（违反任何一条 = 废稿）\n' +
              '1. 杜绝历史污染：不要携带任何「这个网友过去发过的帖子、喝过的咖啡、看过的剧、拍过的戏」的记忆——名单里的「口吻参考」只提供语气和打字习惯，其中出现的一切具体事物（职业、作品、品牌、道具、经历、粉丝称呼）除非主帖本身提到，否则一个字都不许出现在评论里；\n' +
              '2. 精准定位：先读懂主帖，提取主帖的【核心矛盾】——楼主到底在求助什么/吐槽什么/炫耀什么/纠结什么；\n' +
              '3. 严禁转移话题：主帖聊【保研/举报/室友矛盾】，评论就绝对不许聊【特调咖啡、追剧、拍戏、八卦】等无关内容——每条评论只能围绕主帖讲的那件具体的事；\n' +
              '4. 称呼规范：称呼发帖人只能用「楼主」或直接针对 TA 的事说；绝对禁止给楼主起任何名字或称呼（「屿哥」「X哥」这种拿别人网名拼的称呼 = 把自己或别人的名字安到楼主头上，严重错误）；评论里也不许出现评论者自己的网名（名字由系统展示在头像旁）；\n' +
              '5. 拒绝臆测：只能基于主帖白纸黑字写出来的信息评论——楼主没说的内心、内幕、后续一个字不许脑补（楼主没说自己委屈，不能写「他一定很委屈」）。\n' +
              '# 工作流（先分析，后生成；分析写进 thought，40 字内）\n' +
              '第一步：总结主帖到底在求助什么，或者在吐槽什么；\n' +
              '第二步：判断发帖人的情绪（如：绿茶、自私、委屈、愤怒、嘚瑟、破防）；\n' +
              '第三步：选定一种评论视角，生成针对性评论（comment）。\n' +
              '# 七种评论视角（每条先选一种写进 thought，一批自然混搭，不许全是同一种）\n' +
              '- 【共情者】顺着楼主的情绪，给予安慰或支持；\n' +
              '- 【经验分享者】分享自己类似的经历（细节必须贴着本帖的事）；\n' +
              '- 【质疑/杠精】提出不同的观点或质疑（只围绕帖子抬杠，不人身攻击）；\n' +
              '- 【好奇宝宝】针对帖子里的具体细节提问；\n' +
              '- 【玩梗者】用轻松幽默的网络梗化解氛围（梗必须贴着帖子内容玩）；\n' +
              '- 【暴躁老哥】火力全开直接开喷——骂事不骂娘，可以凶、可以怼、可以连问带骂（你差0.3分不从自己身上找原因，搁这儿想阴招？），但不带脏字人身攻击；\n' +
              '- 【阴阳怪气】高级黑反讽——表面顺着楼主的话说，字里行间全是嘲讽（哇哦，心太软的人原来还会盯上别人的奖学金啊？）。\n' +
              '# 锚定铁律（最高优先级，违反即废稿）\n' +
              '- 每条评论只能围绕这篇帖子讲的那件具体的事展开，必须包含或呼应该帖的核心话题词/具体细节；\n' +
              '- 帖子没提到的领域一个字都不许出现：楼主聊应援色吵架，评论里出现考研/图书馆/代拍/装机/打工 = 串台废稿；楼主聊熬夜追剧，评论里出现试驾/装机/健身 = 串台废稿；\n' +
              '- 口吻参考里的人设领域（咖啡/车/剧/考研…）绝不许带进评论——人设只管语气，不管话题。\n' +
              '# 语气适配（口吻配帖子，不配人设自嗨）\n' +
              '- 评论的语气要匹配帖子的性质和楼主的身份：楼主发生活帖（买杯咖啡、晒盒饭），就用生活化口吻回；「家人们」「宝子」这种饭圈大粉口吻只在楼主本人是明星/爱豆、且帖子是粉丝向营业内容时成立——放错地方会让人莫名其妙；\n' +
              '- 控评式发言（「必须澄清」「不许说他」「都别吵了听我说」）在任何帖子下一律禁止——真实网友不控评。\n' +
              '# 走心帖的处理逻辑（文艺/深情/表白类主帖 · 语境判断）\n' +
              '1. 情绪识别：如果主帖内容简短、文艺、带有繁体字、或者发布了「深情文案＋自拍」（典型：「於我而言 你比星璀璨」），说明楼主处于感性、浪漫或私密的情境中——楼主在走心；\n' +
              '2. 绝对禁令：严禁在此类帖子下使用「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类过于聒噪、阴阳怪气的烂梗——这会被视为极度不礼貌的杠精（「锁死」「放毒」在普通网友语境里是阴阳怪气：这俩锁死别祸害别人/别出来恶心大家——跟夸人「甜」完全两个极端）；楼主在走心，你在发癫 = 语境错乱，直接废稿；\n' +
              '3. 正确姿势：真实网友面对这种帖子的反应通常是——感动（被这句话戳中）、吃狗粮（酸一下但祝福）、认真祝福（99/祝好）、或者酸（酸是允许的，但用「酸了/柠檬了」这种克制版本，不用「笑死」）；语气要沉下来跟帖子同频，可以文艺地接一句（用帖子的意象回一句），绝不是聒噪刷梗；\n' +
              '4. 视角降级：此判定命中时，玩梗者/暴躁老哥/阴阳怪气视角全部失效，改用共情者/经验分享者/好奇宝宝的温和版；连「救命」「家人们」这种起手都嫌吵。\n' +
              '# 营销号检测（帖子敷衍，评论也要真实）\n' +
              '- 如果这条帖子本身像营销号/宣发清单（一条里塞了剧宣＋澄清＋求互动＋代言），你的评论要像真实网友一样直接指出来（「这条发出来，水军和老板都沉默了」「怎么一股通稿味」），而不是配合着营业。\n' +
              '# 万能句式禁令（用户明令）\n' +
              '「蹲后续」「蹲一个后续」「这瓜保熟吗」「等一个下文」「让子弹飞一会儿」「前排吃瓜」「瓜子已备好」「小板凳已就位」——放在任何帖子下都「成立」的模板句一律废稿；只有帖子真的是未完结的爆料八卦时才允许出现，且整批最多 1 条。求助帖里「同求」「蹲一个」（求什么蹲什么）不算万能句式。\n' +
              `# 语言铁律\n这是${langLabel(postLang)}帖子${postLang === 'zh-Hans' ? '：所有评论必须以简体中文为主体，最多偶尔夹杂 1-3 个外文字符（www、ㅋㅋ、草），绝对禁止整句英语/日语/韩语/繁体中文的评论' : '：评论用该语言写，要像母语网友的网络口吻；也可以用简体中文'}；每位网友的母语只影响口癖和语气，不改变评论语言。\n` +
              '# 长度与口吻\n每条评论 3~100 字（含标点）。像真人随手打的：偶尔用网络用语（乐、笑死、xswl、u1s1、真下头、蚌埠住了、破防了——视语境，别硬塞；走心帖下一律禁用，见上文）；可以没头没尾、可以全用感叹号/问号、可以有错别字。\n' +
              '# AI 废话黑名单（出现即废稿，一个字都不许沾）\n' +
              '「楼主说的太对了，我也是这么想的」「太对了哈哈哈」及一切变体；「只有我一个人觉得」「只有我觉得」；「笑死，真的是这样」；「总的来说」「不可否认」「确实如此」「在这个事件中」「我们应该」「首先、其次、最后」的结构化长篇大论；「支持」「说得对」「有道理」「深有体会」「说得真好」「感谢分享」「学到了」这类客套空评；纯笑声/纯附和（哈哈哈哈＋太真实了）不许单独成条——评论必须有具体观点或具体信息，哪怕是骂、是质疑、是追问。\n' +
              '# 对比参考——帖子（楼主想举报室友抢保研名额，嘴上说「我不是坏心」）：\n' +
              '- 好（抓住核心矛盾＋真人味）：「她家里条件不好关你什么事？保研凭实力，你差0.3分不从自己身上找原因，搁这儿想阴招？」「嘴上说不是坏心，字里行间全是不甘心，辅导员早点看清你吧」\n' +
              '- 差（称呼错乱＋人设串台，绝对禁止）：「屿哥你最近有在剧里看到什么值得花钱的细节吗？我这周连喝三杯特调都心疼到发抖」（拿别人网名称呼楼主＋把剧和咖啡塞进保研帖＝双重废稿）\n' +
              '# 输出格式（最高优先级）\n' +
              '只输出一个严格合法的 JSON 数组，此外禁止任何文字、解释或代码围栏：\n' +
              '[{"thought":"（内部思考：主帖核心矛盾、楼主情绪、选定的视角，40字内）","comment":"（最终评论，3~100字）"}]\n' +
              `- 数组恰好 ${expect} 个对象，第 N 个对象对应第 N 位网友，顺序不能乱；每个对象只有 thought 和 comment 两个字段；` +
              'comment 绝不以「@任何人」开头、绝不带「回复」「回复 @某某：」字样（回复对象由系统自动标注）；禁止 emoji 和任何格式标记。',
          },
          {
            role: 'user',
            // v25：开头 = 锚定句（带楼主网名）+ 原封不动的帖子正文与话题标签；
            // 引战帖注入「骂声一片」风向指令；输出 [{thought, comment}] JSON 数组
            content: `${anchorHeadOf(post)}\n${topicLine}${flameLine}${tenderLine}\n\n请以这 ${expect} 位网友的口吻各写一条一级评论（都是直接评论上面这篇帖子本身，不是回复别人；先在 thought 里完成核心矛盾/情绪/视角分析，再写 comment；输出恰好 ${expect} 个对象的 JSON 数组，第 N 个对象对应第 N 位网友）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
          },
        ];
        const raw = (await completeWithFallback(config, messages)).text;
        // v22：[{thought, comment}] JSON 数组解析（thought 是「先分析后生成」的
        // 内部思考，不上屏，只取 comment）；有效条数不足半数 → 严格重试一次
        let cands = extractThoughtComments(raw);
        if (cands.length < Math.ceil(expect / 2)) {
          try {
            const raw2 = (
              await completeWithFallback(config, [
                ...messages,
                { role: 'assistant', content: raw.slice(0, 1500) },
                {
                  role: 'user',
                  content: `你上一次的输出不是合法的 JSON 数组（或大量对象无效）。重新输出：恰好 ${expect} 个对象、只含 thought 和 comment 两个字段的 JSON 数组，除 JSON 本身外禁止任何文字，不要代码围栏。再次提醒：comment 3~100 字、必须针对帖子的具体内容、绝不出现万能句式（蹲后续/这瓜保熟吗/等一个下文/让子弹飞）。`,
                },
              ])
            ).text;
            const retry = extractThoughtComments(raw2);
            if (retry.length > cands.length) cands = retry;
          } catch {
            /* 重试失败：按现有结果返回，客户端不铺模板（宁缺毋滥） */
          }
        }
        // v25 校验链：清洗 → 长度（3~110，用户规范 3~100 字留容差）→ 语言 →
        // 万能句式（非豁免帖全废；豁免帖限 1 条）→ 称呼/名称串线（屿哥/自称网名）
        // → 领域私货（保研帖冒出剧+特调）→ 锚定/串台/AI 废话
        const catchallOk = postAllowsCatchall(postContentRaw);
        let catchallUsed = false;
        const postOwnerName = typeof post.authorName === 'string' ? post.authorName : '';
        const commenterNames = personas.map((p) => p.name);
        const list = cands
          .map((s) => sanitizeCommentText(stripReplyPrefix(s)))
          .filter((s) => s.length >= 3 && s.length <= 110)
          // v9 强校验：中文帖出现整句外语 = 串台级错误 → 作废
          .filter((s) => !violatesCommentLang(s, postLang))
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
          // v25 领域私货：评论携带 ≥2 个主帖领域之外的关键词（剧+特调混进保研帖）→ 作废
          .filter((s) => !offTopicIn(s, postContentRaw))
          // v14 锚定强校验：不呼应核心话题词 / 串台 / AI 废话 → 作废
          .filter((s) => commentAnchored(s, postContentRaw));
        return NextResponse.json({ items: list });
      }

      // subreplies：给 threads 里的每条评论各写一条回复（来自 personas 对应网友）
      // v26：单调用线程上限 12→30（楼中楼需求「评论下面 1-5 人」+ 深层嵌套——
      // 每条一级评论 1~5 条直接回复、部分回复再被回复，一批常 20~40 线程）
      const threads = Array.isArray(body.threads)
        ? (body.threads as Record<string, unknown>[])
            .slice(0, 30)
            .map((h) => ({
              authorName: typeof h.authorName === 'string' ? h.authorName.slice(0, 24) : '网友',
              content: typeof h.content === 'string' ? h.content.slice(0, 160) : '',
            }))
            .filter((h) => h.content)
        : [];
      if (!threads.length) return NextResponse.json({ error: 'threads 为空' }, { status: 400 });
      const expect = threads.length;
      const spec = threads
        .map((h, i) => {
          const p = personas[i % personas.length];
          const langNote =
            postLang === 'zh-Hans'
              ? p.lang !== 'zh-Hans'
                ? `；母语${langLabel(p.lang)}，但回复必须用简体中文，最多带1-3个母语字符的口癖`
                : ''
              : `；回复语言跟随帖子用${langLabel(postLang)}或简体中文`;
          // v25：人设降级为「口吻参考」——其中具体事物（职业/作品/道具/经历）
          // 除非主帖和被回复评论提到，否则一个字不许进回复（防 Persona Bleed）
          return `${i + 1}. 评论（楼主是「${typeof post.authorName === 'string' ? post.authorName : '楼主'}」；${h.authorName} 说：「${h.content}」）→ 由 ${p.name} 回复（口吻参考·只学语气，其中具体事物严禁入评：${p.persona}${langNote}）`;
        })
        .join('\n');
      // v28：走心帖（文艺/深情/表白）→ 楼中楼语气同频指令（楼主走心时楼中楼也发癫 = 杠精现场）
      const tender = isTenderPost(postContentRaw, typeof post.mediaDesc === 'string' ? post.mediaDesc : undefined);
      const tenderLine = tender
        ? '\n\n【本帖判定：走心帖（文艺/深情/表白）】楼主在走心（感性/浪漫/私密情境）：楼中楼也要沉下来跟主帖同频——附和感动、酸（克制版）、祝福、文艺接梗都行；「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类聒噪/阴阳怪气烂梗一个字不许出现（楼主走心你发癫 = 语境错乱，废稿）。'
        : '';
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            // v25：同步防串线（第一次看到的陌生人 + 称呼规范 + 口吻参考降级）
            '你现在是一个网友，你正在一篇帖子的评论区里回复别人的评论；回复内容与帖子或被回复的评论无关 = 生成直接失败。' +
            '你在为一个中文论坛（X/Twitter 风格广场）的帖子评论区生成楼中楼回复（回复评论区里某条评论）。' +
            '【绝对红线 1·杜绝历史污染】每位回复者都是第一次看到这篇帖子/这条评论的纯粹陌生人：不要携带任何过去发过的帖子、喝过的咖啡、看过的剧、拍过的戏的记忆；名单里的「口吻参考」只提供语气和打字习惯，其中出现的一切具体事物（职业、作品、品牌、道具、经历、粉丝称呼）除非主帖或被回复评论明确提到，否则一个字都不许出现在回复里。' +
            '\n【绝对红线 2·称呼规范】称呼发帖人只能用「楼主」或直接针对 TA 的事说；称呼被回复者可用其网名或「层主」；绝对禁止给任何人起「屿哥」这种拿别人网名拼的称呼（把自己或别人的名字安到对方头上 = 严重错误）；回复正文里也不许出现回复者自己的网名（名字由系统展示在头像旁）。' +
            '【最高优先级·核心话题词锚定（严禁串台）】用户消息开头原封不动给出了主帖正文、话题标签和「核心话题词」：' +
            '\n- 先读懂被回复的那条评论在说什么，再开口：他说得对就附和补充（贴着主帖话题），说得不对比回去，他问了就回答他，他在玩梗就接梗；禁止无视对方自说自话；' +
            '\n- 每条回复必须 100% 围绕「被回复的那条评论」和「主帖讲的那件事」；' +
            '\n- 帖子没提到的领域一个字都不许出现：楼主聊应援色，回复里不能冒出考研/图书馆/代拍；楼主聊保研举报，回复里不能冒出特调咖啡/追剧/拍戏。' +
            '\n- 不许脑补楼主或对方没说的内心和内幕（「导演其实心疼你」这类洗白脑补——对方没说就是没有）；口吻匹配帖子性质：生活帖用生活化语气，饭圈大粉口吻只在楼主本人是明星时成立，控评式发言（「必须澄清」「不许说他」）一律禁止。' +
            '\n【走心帖（文艺/深情/表白类主帖）的语境判断】主帖简短文艺、带繁体、或深情文案＋自拍（如「於我而言 你比星璀璨」）→ 楼主在走心：楼中楼回复严禁「锁死」「放毒」「笑死」「家人们谁懂啊」「xswl」「当场去世」这类聒噪/阴阳怪气烂梗（「锁死」「放毒」是阴阳怪气不是夸奖；楼主走心你发癫 = 杠精，废稿）；要沉下来同频——附和感动、酸（克制版「酸了/柠檬了」）、祝福、文艺接梗都行，语气跟主帖走。' +
            '\n【人设边界（v15）】人设只决定口吻，绝不许把人设自己领域的话题（考研/装机/打工等帖子没提的东西）带进回复。' +
            `\n【语言铁律】${postLang === 'zh-Hans' ? '这是中文帖：所有楼中楼必须以简体中文为主体，最多偶尔夹杂 1-3 个外文字符（www、ㅋㅋ、草），绝对禁止整句英语/日语/韩语/繁体' : '评论语言跟随帖子语言，也可用简体中文'}。` +
            '\n【格式铁律】直接写回复正文本身：绝对禁止以「@任何人」开头，绝对禁止带「回复」「回复 @某某：」字样（系统会自动标注回复对象）。' +
            '\n【长度】每条回复 3~100 字（含标点），一两句话为主，禁止长篇大论。' +
            '\n【万能句式禁令（用户明令）】「蹲后续」「蹲一个后续」「这瓜保熟吗」「等一个下文」「让子弹飞一会儿」「前排吃瓜」——放在任何评论下都「成立」的模板句一律废稿；只有主帖真的是未完结的爆料八卦时才允许出现，且一批最多 1 条。' +
            '\n【看帖作答】对方在求推荐/求助时，直接给出具体答案（名字+理由/具体做法），不能答非所问。' +
            '\n【AI 废话黑名单（出现即废稿）】「楼主说的太对了，我也是这么想的」「太对了哈哈哈」「只有我一个人觉得」「笑死，真的是这样」「总的来说」「不可否认」「确实如此」「在这个事件中」「我们应该」「首先其次最后」「支持」「说得对」「有道理」绝对禁止；' +
            '回复必须有具体观点或信息。' +
            '\n【网感】笑死、乐、破防了、你小子、一整个无语住、卧槽、妈呀、离谱（走心帖/文艺深情帖下一律禁用，只许克制的酸）；可以没头没尾、可以不用标点、可以有错别字。' +
            '\n【人设一致性】严格符合该网友的人设口吻（暴躁老哥条条带火气，乐子人条条在整活）——但人设只管口吻不管话题。' +
            '每条一行，行数与评论数一致，第 N 行对应第 N 条评论的回复。禁止 emoji 和任何格式标记。',
        },
        {
          role: 'user',
          // v15（用户强制要求）：用户消息开头 = 锚定句 + 原封不动的主帖正文与话题标签
          content: `${anchorHeadOf(post)}\n\n${topicLine}${tenderLine}\n\n评论区里有下面 ${expect} 条评论，请逐条写出对应的楼中楼回复（每条直接写正文，针对那条评论说的话回应并呼应主帖话题词，不要带任何@或「回复」前缀；输出 ${expect} 行）：\n${spec}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      // v14：位置对齐校验（无效项置空串由客户端按位跳过，不向后错位）
      const rawList = await batchWithRetry(config, messages, raw, expect, 600);
      // v22：万能句式豁免（未完结八卦/求助帖）且整批限 1 条
      const catchallOk = postAllowsCatchall(postContentRaw);
      let catchallUsed = false;
      // v25：称呼串线检测名单（本批回复者网名）+ 楼主网名
      const replierNames = personas.map((p) => p.name);
      const postOwnerName = typeof post.authorName === 'string' ? post.authorName : '';
      const list = threads.map((h, i) => {
        const s = rawList[i] ?? '';
        const t = sanitizeCommentText(stripReplyPrefix(s));
        const ctx = `${h.content} ${postContentRaw}`;
        // 用户规范：回复 3~100 字（留容差）
        if (t.length < 3 || t.length > 110) return '';
        if (violatesCommentLang(t, postLang)) return '';
        // v22 万能句式：非豁免帖全废；豁免帖限 1 条
        if (universalPhraseIn(t)) {
          if (!catchallOk || catchallUsed) return '';
          catchallUsed = true;
        }
        // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱作废
        if (tender && loudMemeIn(t)) return '';
        // v25 称呼/名称串线：拿回复者网名拼称呼（屿哥）/自称网名 → 作废
        if (personaBleedIn(t, postOwnerName, replierNames)) return '';
        // v25 领域私货：回复携带 ≥2 个「被回复评论+主帖」领域之外的关键词 → 作废
        if (offTopicIn(t, ctx)) return '';
        // 楼中楼必须呼应「被回复评论 + 主帖」
        if (!commentAnchored(t, ctx)) return '';
        return t;
      });
      return NextResponse.json({ items: list });
    }

    // ================= v33【AI 真人社交】角色驱动生成（charPost/charEngage/charReply） =================

    if (kind === 'charPost' || kind === 'charEngage' || kind === 'charReply') {
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
        const raw = (await completeWithFallback(config, [
          {
            role: 'system',
            content:
              identity +
              '\n\n# Task\n以「' + chName + '」本人的身份在 X 论坛发一条帖子。取材方向（自由组合，全凭你此刻的心情）：' +
              '\n1. 你的记忆里有和' + userName + '相关的事——可以含蓄地发帖念叨（TA感冒了你可以发「家里那位病了还不肯吃药」，但论坛是公开场合，绝不复述私密聊天细节、不直接@TA）；' +
              '\n2. 今日生活素材（下面给）——按你的性格消化它（同一件事，温柔的人觉得治愈，暴躁的人嫌它烦）；' +
              '\n3. 纯粹你自己的生活/心情/工作。' +
              '\n\n# 铁律' +
              '\n1. 口吻完全是你自己的：口头禅、语气、标点习惯从性格和说话风格里长出来；严禁AI万能腔（「总之」「在这个……的时代」「今天想和大家分享」），严禁堆砌网络烂梗；' +
              '\n2. 公开场合分寸：你们的关系可以隐隐透出来（关心/吃醋/提到「某人」），但不写暴露式表白原文；' +
              `\n3. 字数铁律：本次目标【${lp.label}】${lp.min}~${lp.max}字（目标约${target}字，${lp.hint}）——必须命中档位，宁短勿注水；` +
              '\n4. 像随手发的一条，不是作文：碎碎念/没头没尾/只讲一件小事都行；' +
              '\n5. 禁emoji、禁markdown；话题最多1个（可以没有）。' +
              '\n\n# 输出（严格JSON，无任何其他文本）' +
              '\n{"thought":"内部思考（不上屏）：此刻心情+想发什么","content":"帖子正文","has_image":false,"image_description":""}' +
              '\n配图规则：正文出现 实拍/自拍/拍到/合照/打卡/看到了xx 时 has_image=true，并在 content 最自然位置插恰好一个 [图片] 占位符，image_description 以视角开头写30~100字；其余情况 has_image=false。',
          },
          {
            role: 'user',
            content:
              [
                userPosts ? `【${userName}最近在论坛发的帖子（你刷到了，可以视心情回应/吐槽/关心，也可以无视）】\n${userPosts}` : '',
                events.length ? `【你今天的生活素材（选0~2个融入，也可完全不用）】\n${events.map((e) => `- ${e}`).join('\n')}` : '',
                `请以「${chName}」的口吻发这条帖子（直接输出严格JSON）。${bjTimeLine()}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
          },
        ])).text;
        // 解析+校验复用 posts 管线（sanitize/四档字数/配图三元校验/话题规范化）
        const parsed = extractPostItems(raw);
        const aligned = alignPostItems(parsed, 1, [chName], new Set());
        const item = aligned[0];
        if (item && item.content) {
          return NextResponse.json({ content: item.content, textImage: item.textImage });
        }
        // 严格重试一次（强调JSON格式与字数档）
        const raw2 = (await completeWithFallback(config, [
          {
            role: 'system',
            content: `上一次输出无效。你只能输出一个严格合法的JSON对象（{"thought","content","has_image","image_description"}），content字数必须落在${lp.min}~${lp.max}字。其他一切文本都会作废。`,
          },
          { role: 'user', content: `${raw.slice(0, 400)}\n\n重新以「${chName}」的口吻输出这条帖子（严格JSON）。${bjTimeLine()}` },
        ])).text;
        const aligned2 = alignPostItems(extractPostItems(raw2), 1, [chName], new Set());
        const item2 = aligned2[0];
        return NextResponse.json({
          content: item2?.content ?? '',
          textImage: item2?.textImage ?? '',
        });
      }

      // ---- charEngage：角色刷到用户帖子 → 决定点赞/评论 ----
      if (kind === 'charEngage') {
        const p = (body.post ?? {}) as Record<string, unknown>;
        const postContent = typeof p.content === 'string' ? p.content.slice(0, 600) : '';
        const mediaDesc = typeof p.mediaDesc === 'string' && p.mediaDesc.trim() ? `\n（帖子配图：${p.mediaDesc.slice(0, 160)}）` : '';
        if (!postContent) return NextResponse.json({ error: 'post 为空' }, { status: 400 });
        const raw = (await completeWithFallback(config, [
          {
            role: 'system',
            content:
              identity +
              `\n\n# Task\n你刷到了${userName}（你的${chRelation}）在 X 论坛发的帖子。像真人一样决定你的反应。` +
              '\n\n# 决策规则' +
              '\n1. 不是每条都要互动——关系再好也有懒得理的时候：没感觉就 like=false、comment=""（完全无视）；' +
              '\n2. 真心觉得有意思/想怼/想关心才点赞（like=true），别机械每条都赞；' +
              '\n3. 评论必须针对帖子的具体内容——引用TA说的细节、接梗、吐槽、关心、调侃都行；严禁「沙发」「支持」「哈哈哈」「太对了」式空评（出现即作废）；' +
              '\n4. 语气完全是你的说话风格；你们熟（记忆里有底）称呼可以随意，但评论区是公开的，别撒狗粮过头；' +
              '\n5. 评论15~120字，像随手打的一句话。' +
              '\n\n# 输出（严格JSON，无任何其他文本）' +
              '\n{"thought":"内心怎么想的","like":true或false,"comment":"评论内容（决定不评论就输出空串）"}',
          },
          { role: 'user', content: `【${userName}的帖子】\n${postContent}${mediaDesc}\n\n请决定你的反应（严格JSON）。${bjTimeLine()}` },
        ])).text;
        const parsed = parseLooseJSON<Record<string, unknown>>(extractThinkBlocks(raw).text) ?? {};
        const like = parsed.like === true;
        let comment = typeof parsed.comment === 'string' ? sanitizeCommentText(stripReplyPrefix(parsed.comment)) : '';
        if (comment && (comment.length < 15 || comment.length > 150)) comment = '';
        if (comment && (isBannedFiller(comment) || universalPhraseIn(comment))) comment = '';
        // 锚定：评论必须接得上帖子内容（与服务端评论管线同口径）
        if (comment && !commentAnchored(comment, stripImgPh(postContent))) comment = '';
        if (comment && violatesCommentLang(comment, 'zh-Hans')) comment = '';
        return NextResponse.json({ like, comment: comment ? cleanText(comment, 150) : '' });
      }

      // ---- charReply：神回复（用户评论了角色的帖/评论） / thanks（用户点赞后的轻回应） ----
      const postContent = typeof body.postContent === 'string' ? body.postContent.slice(0, 1000) : '';
      const postAuthor = typeof body.postAuthor === 'string' ? body.postAuthor.slice(0, 24) : chName;
      const userComment = typeof body.userComment === 'string' ? body.userComment.slice(0, 300) : '';
      const thanks = body.thanks === true;
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
            identity +
            (thanks
              ? `\n\n# Task\n${userName}没有评论，只是给你的帖子点了个赞。你可以选择在帖子评论区回一句轻松自然的话（比如自然地提一嘴TA、半开玩笑式感谢、自言自语接梗——10~60字，别煽情别刻意），也可以选择什么都不回（直接输出空串）。真人不是每次被点赞都会说话。`
              : `\n\n# Task（神回复）\n${userName}在X论坛评论了你（你的帖子/你的评论），你刷到了。以你的口吻回复TA——「神回复」标准：` +
                '\n1. 接得住TA说的话：TA问什么答什么、TA抛梗接梗、TA关心你你要回应——不是敷衍的「嗯嗯」；' +
                '\n2. 带着你对TA的记忆：TA之前跟你说过的事能用上就自然用上（TA上次说感冒了，这次评论你可以说「你感冒好点没还来冲浪」）；' +
                '\n3. 语气完全是你的说话风格——对TA的称呼、口癖、撒娇/毒舌/温柔按人设来；' +
                '\n4. 20~100字，口语化，像随手回的一句话；' +
                '\n5. 评论区是公开的，别人也看得到：可以自然带点「我们很熟」的气场，但不复述私密聊天细节。') +
            (thanks ? '\n\n# 输出\n直接输出评论正文（决定不回就只输出空串），不要带任何解释。' : '\n\n# 输出\n直接输出回复正文，不要带任何解释。'),
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
      const text = sanitizeCommentText(stripReplyPrefix(raw));
      if (
        text.length >= (thanks ? 8 : 10) &&
        text.length <= (thanks ? 80 : 130) &&
        !violatesCommentLang(text, 'zh-Hans') &&
        !isBannedFiller(text)
      ) {
        return NextResponse.json({ text: cleanText(text, 130) });
      }
      return NextResponse.json({ text: '' });
    }

    if (kind === 'reply' || kind === 'dm') {
      const authorRaw = body.author as { name?: unknown; persona?: unknown; lang?: unknown } | undefined;
      const name = typeof authorRaw?.name === 'string' ? authorRaw.name.slice(0, 24) : '网友';
      const persona = typeof authorRaw?.persona === 'string' ? authorRaw.persona.slice(0, 300) : '普通论坛网友';
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
              // v24（用户本次 Prompt 规格）：楼层对话回复按 Role/Task/Rules 结构重写
              `# Role（角色）\n你是一个真实的网友「${name}」，正在一条帖子的评论区参与楼层对话。口吻人设：${persona}。${langLine}` +
              '\n# Task（任务）\n根据【主帖内容】和【上一句对话】，生成一条符合人类社交逻辑的回复：对方问什么就答什么，对方抛观点就接观点，对方玩梗就接梗，对方情绪上头就先接住情绪再说事。' +
              '\n# Rules（核心规则）' +
              '\n1. 拒绝幻觉：绝对不能生硬地加入主帖和对话里完全没有提到的名词、剧名、人名、梗（比如突然聊起某部剧或某个导演）——除非主帖或上一句对话明确提到了它们；' +
              '\n2. 紧扣上下文：回复必须 100% 针对【上一句对话】说的话，同时贴着【主帖内容】讲的那件事；绝对禁止把与帖子无关的新话题（试驾/吃饭/买衣服之类）带进回复；' +
              '\n3. 字数控制：20-80 字以内，必须口语化，像真人随手打的一句话——可以不用标点或全用感叹号、可以有错别字和缩写（xswl、u1s1、笑死、破防了）；' +
              '\n4. 输出格式：直接输出回复的正文，不要带任何解释；' +
              '\n5. 接住对话链：若给出了【用户回复的那条评论】，先看清用户回复的是谁、在接什么话头——你的回复要接用户这条话本身（回应/反驳/追问/接梗都行），禁止无视 TA 自说自话；【这层楼最近的对话】里每条发言都有各自的名字，那是别人说的，不要把别人的话当成自己说的；' +
              '\n# 废稿红线（出现即作废）' +
              '\n- 万能句式：「蹲后续」「这瓜保熟吗」「等一个下文」「让子弹飞一会儿」「前排吃瓜」这类放在任何帖子下都「成立」的模板句（主帖真是未完结爆料八卦时最多 1 条）；' +
              '\n- AI 废话：「楼主说的太对了，我也是这么想的」「太对了哈哈哈」「只有我一个人觉得」「总的来说」「不可否认」「确实如此」「首先其次最后」，以及「支持」「说得对」「有道理」「深有体会」这类客套空评；' +
              '\n- 禁止以「@任何人」开头、禁止带「回复」「回复 @某某：」字样（系统自动标注回复对象）；禁止 emoji 和任何格式标记。',
          },
          {
            role: 'user',
            content: `${ctx}\n\n请以「${name}」的口吻回复这条楼层对话（直接输出回复正文，20-80 字口语化，不要带任何解释）。${bjTimeLine()}` },
        ])).text;
        const text = sanitizeCommentText(stripReplyPrefix(raw));
        // v24 字数铁律（用户规范 20-80 字，留容差）：过短/过长 → 返回空
        // v9 强校验：中文帖整句外语回复 → 返回空
        // v14 锚定校验：串台/AI 废话 → 返回空
        // v22 万能句式：非未完结八卦帖 → 返回空（客户端不再兜底，宁缺毋滥）
        const catchallHit = universalPhraseIn(text) && !postAllowsCatchall(`${p?.content ?? ''} ${rtText} ${postContent}`);
        if (
          text.length >= 12 &&
          text.length <= 95 &&
          !catchallHit &&
          !violatesCommentLang(text, postLang) &&
          !isBannedFiller(text) &&
          // v26：锚定语料 = 用户这条回复 + 用户回复的那条评论 + 主帖（围观者必须接得上话）
          commentAnchored(text, `${p?.content ?? ''} ${rtText} ${postContent}`)
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
      const raw = (await completeWithFallback(config, [
        {
          role: 'system',
          content:
            `你是中文论坛（X/Twitter 风格广场）的用户「${name}」，正在论坛私信里和${userName}聊天。人设：${persona}。` +
            '私信用简体中文，自然口语，像真人打字。' +
            '字数不限：一两句到几十字都行。禁止 emoji，禁止任何格式标记，只输出回复正文。',
        },
        { role: 'user', content: `最近的对话：\n${history || '（刚开始聊）'}\n\n请以「${name}」的口吻接下一条私信。${bjTimeLine()}` },
      ])).text;
      return NextResponse.json({ text: cleanText(raw, 300) });
    }

    return NextResponse.json({ error: '未知 kind' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成失败' },
      { status: 500 },
    );
  }
}
