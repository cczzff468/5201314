/**
 * 阅读 App · 本地书籍解析（txt / epub，从手机导入）
 * ---------------------------------------------------------------------------
 * parseTxtBook：编码探测（UTF-8 BOM / UTF-8 / GB18030 兜底）→ 章节标题正则切分
 * parseEpubBook：无依赖的极简 ZIP 读取器（EOCD → 中央目录 → 本地头解压，
 *               deflate 用 node:zlib）→ container.xml → OPF → spine 逐章提取正文
 * 服务端专用（Node runtime），不做任何网络请求。
 */
import { inflateRawSync } from 'node:zlib';
import iconv from 'iconv-lite';
import { htmlToText } from './engine';

export interface ParsedLocalChapter {
  title: string;
  content: string;
}

export interface ParsedLocalBook {
  /** 书名 */
  name: string;
  author: string | null;
  /** 简介（首章前 150 字 / epub 描述元数据） */
  intro: string | null;
  /** 封面图片扩展名（epub 提取到封面时） */
  coverExt: string | null;
  /** 封面图片二进制（epub 提取到封面时） */
  coverBuf: Buffer | null;
  chapters: ParsedLocalChapter[];
}

/** 章节数量上限（防爆库） */
const MAX_CHAPTERS = 3000;
/** 单章正文长度上限（epub） */
const MAX_CHAPTER_CHARS = 200_000;

/* ================================ 通用工具 ================================ */

/** 文件名 → 书名（去路径、去扩展名） */
function baseName(fileName: string): string {
  const noPath = fileName.split(/[\\/]/).pop() || fileName;
  return noPath.replace(/\.[^./\\]*$/, '').trim();
}

/** Buffer → 文本：UTF-8（含 BOM 剥离）→ GB18030 兜底 */
function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return stripBom(new TextDecoder('utf-8').decode(buf));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 非 UTF-8：按 GB18030（GBK 超集，国内 txt 主流编码）解码
    return iconv.decode(buf, 'gb18030');
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** XML/HTML 文本节点 → 纯文本（实体解码 + 去标签） */
function xmlDecode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // 先解码实体（描述里常见转义 HTML：&lt;p&gt;…），再去标签
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0?39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 从标签字符串里取属性值（双引号/单引号均可） */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2] ?? '') : '';
}

/** 取某个元数据标签内容（允许任意命名空间前缀，如 dc:title / opf:title） */
function metaTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}\\s*>`,
    'i',
  );
  const m = block.match(re);
  return m ? xmlDecode(m[1]) : null;
}

/** 首章正文 → 150 字简介 */
function introFromContent(content: string): string | null {
  const t = content.replace(/\s+/g, ' ').trim().slice(0, 150);
  return t ? `${t}…` : null;
}

/* ================================ TXT 解析 ================================ */

/**
 * 章节标题行（整行匹配）：
 * - 第[数字/中文数字]章|节|卷|回|部|集 + 短标题（整行 ≤ 60 字）
 * - 楔子 / 序章 / 序言 / 序 / 尾声 / 后记 / 终章 / 番外（+ 短后缀）
 */
const CHAPTER_LINE_RE =
  /^[ \t　]*(第[0-9零一二三四五六七八九十百千万两〇]{1,12}[章节卷回部集][^\n]{0,48}|(?:楔子|序章|序言|序幕|引子|尾声|后记|终章|番外篇|番外|序|楔)[^\n]{0,28})[ \t　]*$/;

/** 正文清洗：行尾空白 → 去掉；3+ 连续空行 → 1 个空行 */
function cleanContent(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t　]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseTxtBook(buf: Buffer, fileName: string): ParsedLocalBook {
  // ① 编码探测 + 统一换行
  const text = decodeText(buf).replace(/\r\n?/g, '\n');

  // ② 收集章节标题行
  const markers: { title: string; start: number; end: number }[] = [];
  const re = new RegExp(CHAPTER_LINE_RE.source, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && markers.length < MAX_CHAPTERS) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const title = m[0].trim().replace(/[ \t　]{2,}/g, ' ');
    if (title.length > 60 || title.length < 2) continue; // 整行 ≤ 60 字才算章节标题
    markers.push({ title, start: m.index, end: m.index + m[0].length });
  }

  const chapters: ParsedLocalChapter[] = [];

  if (markers.length < 2) {
    // ③a 没有可识别的章节结构 → 整本一章
    const content = cleanContent(text);
    if (content) chapters.push({ title: '全文', content });
  } else {
    // ③b 按标题行切分
    const head = text.slice(0, markers[0].start).trim();
    let prependHead = '';
    if (head) {
      if (head.length < 500) {
        prependHead = cleanContent(head); // 开头太短 → 并入第一章
      } else {
        const c = cleanContent(head); // 开头较长 → 独立成章
        if (c) chapters.push({ title: '开篇', content: c });
      }
    }
    for (let i = 0; i < markers.length && chapters.length < MAX_CHAPTERS; i++) {
      const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
      let content = cleanContent(text.slice(markers[i].end, end));
      if (i === 0 && prependHead) content = `${prependHead}\n\n${content}`;
      chapters.push({ title: markers[i].title, content });
    }
  }

  return {
    name: baseName(fileName) || '未命名',
    author: null,
    intro: chapters.length ? introFromContent(chapters[0].content) : null,
    coverExt: null,
    coverBuf: null,
    chapters,
  };
}

/* ================================ ZIP 读取器 ================================ */

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  crc: number;
  localOffset: number;
}

/** zip 内路径规整：去首尾 / 与 ./、消化 .. 段 */
function normalizeZipPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** 极简 ZIP 读取器（EOCD → 中央目录 → 本地头；支持 stored/deflate；缓存解压结果） */
class ZipReader {
  private buf: Buffer;
  private cache = new Map<string, Buffer>();
  readonly entries = new Map<string, ZipEntry>();

  constructor(buf: Buffer) {
    this.buf = buf;
    // ① 从尾部扫 EOCD（签名 0x06054b50，含最长 65535 字节注释）
    let eocd = -1;
    const scanEnd = Math.max(0, buf.length - (22 + 65535));
    for (let i = buf.length - 22; i >= scanEnd; i--) {
      if (buf.readUInt32LE(i) !== 0x06054b50) continue;
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLen <= buf.length) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('不是有效的 zip/epub 文件（找不到目录结尾记录）');
    const count = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff) throw new Error('暂不支持 zip64 格式');
    // ② 逐条读中央目录
    let p = cdOffset;
    for (let i = 0; i < count && p + 46 <= buf.length; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      const method = buf.readUInt16LE(p + 10);
      const crc = buf.readUInt32LE(p + 16);
      const compSize = buf.readUInt32LE(p + 20);
      const uncompSize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const localOffset = buf.readUInt32LE(p + 42);
      const name = normalizeZipPath(buf.toString('utf8', p + 46, p + 46 + nameLen));
      if (name) this.entries.set(name, { name, method, compSize, uncompSize, crc, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  private find(rawName: string): ZipEntry | null {
    const name = normalizeZipPath(rawName);
    const hit = this.entries.get(name);
    if (hit) return hit;
    // 大小写兜底（部分制作粗糙的 epub 目录与 zip 条目名大小写不一致）
    const lower = name.toLowerCase();
    for (const e of this.entries.values()) {
      if (e.name.toLowerCase() === lower) return e;
    }
    return null;
  }

  /** 解压单个文件（带缓存）；不存在返回 null */
  read(rawName: string): Buffer | null {
    const name = normalizeZipPath(rawName);
    const cached = this.cache.get(name);
    if (cached) return cached;
    const entry = this.find(name);
    if (!entry) return null;
    const lo = entry.localOffset;
    if (lo + 30 > this.buf.length || this.buf.readUInt32LE(lo) !== 0x04034b50) return null;
    // 本地头：sig(4) ver(2) flags(2) method(2) time(2) date(2) crc(4) comp(4) uncomp(4)
    //         fnLen(2)@26 extraLen(2)@28 → 数据起始 = 30 + fnLen + extraLen
    // 大小以中央目录为准（兼容数据描述符位），文件名/extra 长度以本地头为准
    const fnLen = this.buf.readUInt16LE(lo + 26);
    const extraLen = this.buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + fnLen + extraLen;
    const comp = this.buf.subarray(dataStart, dataStart + entry.compSize);
    let out: Buffer;
    if (entry.method === 0) {
      out = Buffer.from(comp);
    } else if (entry.method === 8) {
      out = inflateRawSync(comp);
    } else {
      return null; // 其他压缩算法不支持
    }
    this.cache.set(name, out);
    return out;
  }

  /** 解压并按文本读（UTF-8 → GB18030 兜底） */
  getText(name: string): string | null {
    const b = this.read(name);
    return b ? decodeText(b) : null;
  }
}

/* ================================ EPUB 解析 ================================ */

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

/** OPF 相对路径 → zip 内完整路径（URL 解码 + 目录拼接 + 规整） */
function resolveZipHref(opfDir: string, href: string): string {
  let h = href.trim();
  try {
    h = decodeURIComponent(h);
  } catch {
    /* 保留原样（可能本身就没转义） */
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) return ''; // 外链不进 zip
  h = h.split('#')[0].split('?')[0];
  if (!h) return '';
  const joined = opfDir && !h.startsWith('/') ? `${opfDir}/${h}` : h;
  return normalizeZipPath(joined);
}

/** 章节标题：<title> → <h1>/<h2> → 空 */
function extractDocTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    const v = xmlDecode(t[1]);
    if (v) return v.slice(0, 60);
  }
  const h = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (h) {
    const v = xmlDecode(h[1]);
    if (v) return v.slice(0, 60);
  }
  return '';
}

export function parseEpubBook(buf: Buffer, fileName: string): ParsedLocalBook {
  const zip = new ZipReader(buf);

  // ① container.xml → OPF 路径
  let opfPath = '';
  const container = zip.getText('META-INF/container.xml');
  if (container) {
    const m = container.match(/<rootfile[^>]*?full-path\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (m) {
      const raw = m[1] || m[2] || '';
      try {
        opfPath = decodeURIComponent(raw);
      } catch {
        opfPath = raw;
      }
    }
  }
  if (!opfPath) {
    // 兜底：直接找 zip 里第一个 .opf
    for (const name of zip.entries.keys()) {
      if (name.toLowerCase().endsWith('.opf')) {
        opfPath = name;
        break;
      }
    }
  }
  if (!opfPath) throw new Error('epub 结构异常：找不到 OPF（content.opf）');

  const opfText = zip.getText(opfPath);
  if (!opfText) throw new Error('epub 结构异常：OPF 文件读取失败');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // ② 元数据（允许任意命名空间前缀）
  const metaBlock = opfText.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i)?.[1] || opfText;
  const title = metaTag(metaBlock, 'title');
  const author = metaTag(metaBlock, 'creator');
  const description = metaTag(metaBlock, 'description');

  // ③ manifest：id → { href, media-type, properties }
  const manifest = new Map<string, ManifestItem>();
  for (const mm of opfText.matchAll(/<item\s[^>]*>/gi)) {
    const tag = mm[0];
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, { id, href, mediaType: attr(tag, 'media-type'), properties: attr(tag, 'properties') });
  }

  // ④ spine：按顺序取 idref → manifest href
  const spineBlock = opfText.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i)?.[1] || '';
  const spineIds: string[] = [];
  for (const mm of spineBlock.matchAll(/<itemref\s[^>]*>/gi)) {
    const idref = attr(mm[0], 'idref');
    if (idref) spineIds.push(idref);
  }

  // ⑤ 封面：properties="cover-image" → <meta name="cover" content="itemId"/>
  let coverHref: string | null = null;
  for (const item of manifest.values()) {
    if (/(?:^|\s)cover-image(?:\s|$)/i.test(item.properties)) {
      coverHref = item.href;
      break;
    }
  }
  if (!coverHref) {
    for (const mm of opfText.matchAll(/<meta\s[^>]*>/gi)) {
      if (attr(mm[0], 'name').toLowerCase() !== 'cover') continue;
      const item = manifest.get(attr(mm[0], 'content'));
      if (item) {
        coverHref = item.href;
        break;
      }
    }
  }
  let coverExt: string | null = null;
  let coverBuf: Buffer | null = null;
  if (coverHref) {
    const coverPath = resolveZipHref(opfDir, coverHref);
    const b = coverPath ? zip.read(coverPath) : null;
    if (b && coverPath.includes('.')) {
      const ext = coverPath.slice(coverPath.lastIndexOf('.') + 1).toLowerCase();
      if (/^[a-z0-9]{2,5}$/.test(ext)) {
        coverExt = ext;
        coverBuf = b;
      }
    }
  }

  // ⑥ spine 逐项提取正文
  const chapters: ParsedLocalChapter[] = [];
  let secNo = 0;
  for (const idref of spineIds) {
    if (chapters.length >= MAX_CHAPTERS) break;
    const item = manifest.get(idref);
    if (!item) continue;
    const mt = item.mediaType.toLowerCase();
    const isDoc = mt.includes('xhtml') || mt.includes('html') || /\.(xhtml|html|htm)$/i.test(item.href);
    if (!isDoc) continue;
    const filePath = resolveZipHref(opfDir, item.href);
    if (!filePath) continue;
    const raw = zip.getText(filePath);
    if (!raw) continue;
    secNo++;
    const text = htmlToText(raw).slice(0, MAX_CHAPTER_CHARS);
    if (!text) continue; // 空文档（纯封面页等）跳过
    if (text.length < 80 && chapters.length > 0) {
      // 过短的章节并入上一章（封面赠言、短引文等）
      const prev = chapters[chapters.length - 1];
      prev.content = `${prev.content}\n${text}`.slice(0, MAX_CHAPTER_CHARS);
      continue;
    }
    chapters.push({ title: extractDocTitle(raw) || `第${secNo}节`, content: text });
  }

  return {
    name: title || baseName(fileName) || '未命名',
    author: author || null,
    intro: description ? description.slice(0, 300) : chapters.length ? introFromContent(chapters[0].content) : null,
    coverExt,
    coverBuf,
    chapters,
  };
}
