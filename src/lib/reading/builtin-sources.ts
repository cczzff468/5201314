/**
 * 阅读 App 内置书源（2026-11-22 396 合集内置版）。
 *
 * 组成：
 * ① VERIFIED_SOURCES —— 沙箱全链路实测通过的核心源（搜索→目录→正文验证）。
 * ② user-sources.json —— 用户提供的 396 书源合集（Legado 3.0，1121 版；
 *    已按 URL 去重共 388 源全部内置；书源管理里可「一键筛活」校验启停）。
 *
 * 书源管理支持随时校验：失效源自动停用，「清理失效」一键删除；
 * 书架/历史里对失效源的书按名称/URL 前缀自动自愈。
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
];

/** ② 用户提供的 396 书源合集（Legado 3.0，按 URL 去重后 388 源） */
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
