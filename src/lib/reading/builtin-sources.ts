/**
 * 阅读 App 内置书源（2026-11-21 大版本重构）。
 *
 * 组成：
 * ① VERIFIED_SOURCES —— 沙箱全链路实测通过的 11 个核心源（搜索→目录→正文双关键词
 *    验证：斗破苍穹 + 诡秘之主；含 3 个耽美源：伪装学渣/放学等我等原著可搜可读）。
 * ② user-sources.json —— 用户提供的 396 个精选书源（Legado 3.0 合集，用户实测可用，
 *    按用户要求全量内置：涵盖小说/漫画/出版/女频/有声等分组）。
 *
 * 老版本内置里仅单关键词通过、未过双验证的源已全部除名（route 启动播种时会把库里
 * 这些「已除名内置源」清理掉）；书架/历史里对失效源的书按名称/URL 前缀自动自愈。
 *
 * 用户可随时导入更多：书源管理支持粘贴 JSON / 输入 URL / 手机上传文件。
 */
import type { LegadoSource } from './engine';
import USER_SOURCES_JSON from './user-sources.json';

/** URL 规范化（尾部斜杠统一，用于去重比较） */
export function normSourceUrl(u: string): string {
  return (u || '').trim().replace(/\/+$/, '/');
}

/** ① 实测可用核心源（全链路双验证，enabled=true） */
export const VERIFIED_SOURCES: LegadoSource[] = [
  {
    bookSourceName: '夜天连小说',
    bookSourceUrl: 'http://www.yetianlian.info/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.yetianlian.info/s.php?ie=utf-8&q={{key}}',
    ruleSearch: {
      author: 'class.author@text',
      bookList: 'class.bookbox',
      bookUrl: 'a@href',
      checkKeyWord: '我的',
      coverUrl: 'img@src',
      kind: 'class.cat@text',
      lastChapter: 'class.update@text',
      name: 'class.bookname@text',
    },
    ruleBookInfo: {
      author: 'span.1@text',
      coverUrl: 'img@src',
      intro: 'class.intro@text',
      kind: 'span.2@text',
      lastChapter: 'span.last.1@text',
      name: 'h2@text',
      wordCount: 'span.4@text',
    },
    ruleToc: { chapterList: 'dd', chapterName: 'a@text', chapterUrl: 'a@href' },
    ruleContent: { content: 'div#content.showtxt@text', nextContentUrl: 'text.下一章@href' },
  },
  {
    bookSourceName: 'TXT书库',
    bookSourceUrl: 'http://www.txtshuku.org/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.txtshuku.org/search.php?searchkey={{key}}',
    ruleSearch: {
      author: 'class.book_other.0@tag.span.0@text',
      bookList: 'id.sitembox@tag.dl',
      bookUrl: 'tag.a.1@href',
      coverUrl: 'tag.img@src',
      lastChapter: 'class.book_other.1@tag.a.0@text##最新章节：',
      name: 'tag.a.1@text',
      wordCount: 'class.book_other.0@tag.span.-1@text',
    },
    ruleBookInfo: {
      author: '[property="og:novel:author"]@content',
      coverUrl: '[property="og:image"]@content',
      intro: 'id.bookintro@html',
      kind: '[property="og:novel:category"]@content',
      lastChapter: '[property="og:novel:latest_chapter_name"]@content',
      name: '[property="og:novel:book_name"]@content',
      wordCount: '.count@tag.span.-1@text',
    },
    ruleToc: { chapterList: 'id.readerlist@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@html',
      replaceRegex: '##感谢.*打赏.*|\\【看书福利.*|\\（未完待续\\）',
    },
  },
  {
    bookSourceName: '平凡文学',
    bookSourceUrl: 'http://www.pfwx.com/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.pfwx.com/modules/article/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36"}',
    ruleSearch: {
      author: 'class.book_other@tag.span.0@text',
      bookList: 'class.grid@tag.tr',
      bookUrl: 'tag.a.0@href',
      kind: 'class.book_other@tag.span.1@text',
      lastChapter: 'tag.a.1@text',
      name: 'tag.a.0@text',
      update: 'class.book_other@tag.span.2@text',
    },
    ruleBookInfo: {
      author: 'tag.span.0@text',
      coverUrl: '',
      intro: 'id.intro@tag.td.0@text',
      kind: 'tag.span.1@text',
      lastChapter: 'tag.a.2@text',
      name: 'tag.h1@text',
    },
    ruleToc: { chapterList: 'class.chapterlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@tag.div@html',
      nextContentUrl: 'text.下一页@href',
      replaceRegex: '##平凡文学.*|www\\.pfwx\\.com',
    },
  },
  {
    bookSourceName: '蚂蚁阅读',
    bookSourceUrl: 'http://wap.imayitxt.com/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://wap.imayitxt.com/search.php,{\"method\":\"POST\",\"body\":\"searchkey={{key}}\"}',
    ruleSearch: {
      bookList: 'class.weibiaoti@tag.li',
      bookUrl: 'tag.a.0@href',
      coverUrl: '',
      kind: '',
      lastChapter: 'tag.a.1@text##最新：',
      name: 'tag.a.0@text',
    },
    ruleToc: { chapterList: 'class.zjlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'class.readerCon@html', nextContentUrl: '' },
  },
  {
    bookSourceName: '穿越文学',
    bookSourceUrl: 'http://www.kk169.net/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.kk169.net/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36"}',
    ruleSearch: {
      author: 'class.book_other@tag.span.0@text',
      bookList: 'class.grid@tag.tr',
      bookUrl: 'tag.a.0@href',
      kind: 'class.book_other@tag.span.1@text',
      lastChapter: 'tag.a.1@text',
      name: 'tag.a.0@text',
    },
    ruleBookInfo: {
      author: 'tag.span.0@text',
      intro: 'id.intro@tag.td.0@text',
      kind: 'tag.span.1@text',
      lastChapter: 'tag.a.2@text',
      name: 'tag.h1@text',
    },
    ruleToc: { chapterList: 'class.chapterlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@tag.div@html',
      nextContentUrl: 'text.下一页@href',
      replaceRegex: '##穿越文学.*|www\\.kk169\\.net',
    },
  },
  {
    bookSourceName: '穿越小说',
    bookSourceUrl: 'http://www.kk169.la/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.kk169.la/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36"}',
    ruleSearch: {
      author: 'class.book_other@tag.span.0@text',
      bookList: 'class.grid@tag.tr',
      bookUrl: 'tag.a.0@href',
      kind: 'class.book_other@tag.span.1@text',
      lastChapter: 'tag.a.1@text',
      name: 'tag.a.0@text',
    },
    ruleToc: { chapterList: 'class.chapterlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@tag.div@html',
      nextContentUrl: 'text.下一页@href',
      replaceRegex: '##穿越小说.*|kk169\\.la',
    },
  },
  {
    bookSourceName: '玄幻阁',
    bookSourceUrl: 'http://www.xuanhuange.net/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.xuanhuange.net/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36"}',
    ruleSearch: {
      author: 'class.book_other@tag.span.0@text',
      bookList: 'class.grid@tag.tr',
      bookUrl: 'tag.a.0@href',
      kind: 'class.book_other@tag.span.1@text',
      lastChapter: 'tag.a.1@text',
      name: 'tag.a.0@text',
    },
    ruleToc: { chapterList: 'class.chapterlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@tag.div@html',
      nextContentUrl: 'text.下一页@href',
      replaceRegex: '##玄幻阁.*|xuanhuange\\.net',
    },
  },
  {
    bookSourceName: '苍茫文学',
    bookSourceUrl: 'http://www.baowx.com/',
    bookSourceGroup: '小说',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'http://www.baowx.com/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36"}',
    ruleSearch: {
      author: 'class.book_other@tag.span.0@text',
      bookList: 'class.grid@tag.tr',
      bookUrl: 'tag.a.0@href',
      kind: 'class.book_other@tag.span.1@text',
      lastChapter: 'tag.a.1@text',
      name: 'tag.a.0@text',
    },
    ruleToc: { chapterList: 'class.chapterlist@tag.dd', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: {
      content: 'id.content@tag.div@html',
      nextContentUrl: 'text.下一页@href',
      replaceRegex: '##苍茫文学.*|baowx\\.com',
    },
  },
  {
    bookSourceName: '耽美小说',
    bookSourceUrl: 'https://www.blxsw.cc/',
    bookSourceGroup: '耽美',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'https://www.blxsw.cc/s.php?ie=utf-8&q={{key}}',
    ruleSearch: {
      author: 'class.author@text',
      bookList: 'class.bookbox',
      bookUrl: 'a@href',
      checkKeyWord: '伪装学渣',
      coverUrl: 'img@src',
      kind: 'class.cat@text',
      lastChapter: 'class.update@text',
      name: 'class.bookname@text',
    },
    ruleToc: { chapterList: 'dd', chapterName: 'a@text', chapterUrl: 'a@href' },
    ruleContent: { content: 'div#content.showtxt@text', nextContentUrl: 'text.下一章@href' },
  },
  {
    bookSourceName: '福书网',
    bookSourceUrl: 'https://www.fushutxt.cc/',
    bookSourceGroup: '耽美',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'https://www.fushutxt.cc/search.php?q={{key}}',
    ruleSearch: {
      bookList: 'class.bookbox',
      bookUrl: 'a@href',
      checkKeyWord: '放学等我',
      name: 'class.bookname@text',
      author: 'class.author@text',
    },
    ruleToc: { chapterList: 'dd', chapterName: 'a@text', chapterUrl: 'a@href' },
    ruleContent: { content: 'div#content@text', nextContentUrl: 'text.下一章@href' },
  },
  {
    bookSourceName: '52书库·耽美',
    bookSourceUrl: 'https://www.52shuku.net/',
    bookSourceGroup: '耽美',
    enabled: true,
    bookSourceType: 0,
    searchUrl: 'https://www.52shuku.net/search.php?searchkey={{key}}',
    header: '{"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36"}',
    ruleSearch: {
      bookList: 'class.result-list',
      bookUrl: 'tag.a.0@href',
      checkKeyWord: '落不下',
      name: 'class.result-game-detail@tag.a@text',
      author: 'class.result-game-item.1@tag.span.1@text',
    },
    ruleToc: { chapterList: 'class.chapterlist', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'id.content@html', replaceRegex: '##52书库.*' },
  },
];

/** ② 用户提供的 396 个精选源（Legado 3.0 合集，全量内置） */
const USER_SOURCES = USER_SOURCES_JSON as unknown as LegadoSource[];

/**
 * 合并去重：实测核心源优先排前，用户合集按 URL 去重后依次补齐。
 */
const seen = new Set(VERIFIED_SOURCES.map((s) => normSourceUrl(s.bookSourceUrl)));
const merged: LegadoSource[] = [...VERIFIED_SOURCES];
for (const s of USER_SOURCES) {
  const key = normSourceUrl(s.bookSourceUrl || '');
  if (!key || seen.has(key)) continue;
  seen.add(key);
  merged.push({ ...s, enabled: s.enabled !== false });
}

export const BUILTIN_BOOK_SOURCES: LegadoSource[] = merged;
