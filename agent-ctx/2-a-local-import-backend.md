# Task 2-a · 本地导入后端（txt/epub 解析 + /api/reading/local）

> Agent: backend agent · 状态: 完成 · 日期: 2026-11-21
> 前置：LocalBook / LocalChapter 模型已在 prisma/schema.prisma 并推库（Task 1 完成）。

## 一、交付文件（仅新增，未改动任何既有文件）

1. **`src/lib/reading/local-parse.ts`** — 解析层（纯函数，Node runtime）
   - `parseTxtBook(buf, fileName)`：编码探测（UTF-8 BOM 剥离 → UTF-8 strict → GB18030 兜底，iconv-lite）；`\r\n` 归一；章节标题行整行匹配切分：
     - `第[0-9零一二三四五六七八九十百千万两〇]{1,12}[章节卷回部集]+短标题`（整行 ≤ 60 字）
     - 楔子/序章/序言/序幕/引子/尾声/后记/终章/番外/序/楔（+ 短后缀）
     - 首个标记前的开头：< 500 字并入第一章，≥ 500 字独立成章「开篇」；< 2 个标记 → 单章「全文」
     - 清洗：行尾空白去除、`\n{3,}` → `\n\n`；章节上限 3000
   - `parseEpubBook(buf, fileName)`：**无依赖 ZIP 读取器**（EOCD 尾扫含注释、中央目录、本地头 extra 跳过、method 0 stored / method 8 deflateRawSync、解压结果缓存、条目名大小写兜底；zip64 显式抛错）→ container.xml（full-path 支持 %20 / 单双引号）→ OPF（正则解析；元数据支持任意命名空间前缀 dc:/opf:，manifest/spine/cover 双路探测 properties="cover-image" 或 meta name="cover"）→ spine 逐项取 xhtml/html 正文（复用 `engine.ts` 的 `htmlToText`）；标题取 `<title>`→`<h1>/<h2>`→`第N节`；< 80 字短章并入上一章；空文档跳过；单章 20 万字、全书 3000 章上限
   - 返回 `ParsedLocalBook { name, author, intro, coverExt, coverBuf, chapters }`（txt 的 cover 恒 null；epub intro 优先 dc:description 前 300 字）

2. **`src/app/api/reading/local/route.ts`** — 接口层（`runtime='nodejs'`, `dynamic='force-dynamic'`）
   - `GET ?bookId=&idx=`（或 `?bookUrl=local:xxx&idx=`）→ `{ title, content }`；不存在 404 `{error:'章节不存在'}`；缺参 400
   - `POST` multipart `file` 字段：校验（缺文件/≤20MB/扩展名 .txt|.epub，非法 400）→ 解析（0 章 400 `'解析失败：没有读到内容'`）→ 建 LocalBook → 封面写 `public/reading-covers/{localBookId}.{ext}`（写盘失败不阻断导入）→ LocalChapter **createMany 分批 100 条**（id=`{bookId}:{idx}`）→ 建 ShelfBook → `{ ok:true, id, name, chapters }`；异常 500 中文错误
   - `DELETE ?bookUrl=local:xxx` → 删 LocalChapter + LocalBook + ShelfBook（顺带尽力清理封面文件）→ `{ok:true}`

## 二、给前端 / 集成 Agent 的契约（重要）

- 本地书在书架的标识：`sourceId='local'`，`sourceName='本地导入'`，`bookUrl='local:{localBookId}'`（唯一）
- 目录 chapters JSON 每项 `{"title": "...", "url": "local:{localBookId}:{idx}"}`
- **读正文**：`GET /api/reading/local?bookUrl=local:xxx&idx=N`（idx 0-based），返回 `{title, content}`（content 为 `\n` 分段纯文本，与在线书源章节接口同构，可直接复用阅读器排版）
- 封面 URL：`/reading-covers/{id}.{ext}`（静态文件直链，无防盗链，前端 `<img>` 直用即可，**不要**走 /api/reading/cover 代理）
- 移出书架时若 `bookUrl.startsWith('local:')` 请调 `DELETE /api/reading/local?bookUrl=...`（否则章节正文和封面文件会残留）

## 三、测试证据（全部通过）

- 解析单测（`/home/z/local-import-tests/test-parse.ts`，35 项断言）：UTF-8 / GB18030 / BOM txt 各 5 章切分正确；无标记书单章「全文」；路径+扩展名剥离；epub 元数据/实体解码/封面提取/短章合并/`第N节`兜底/子目录解析；伪 epub 抛中文错误；3500 标记截断为 3000 章
- 刁钻 epub 单测（`test-tricky.ts`，8 项）：EOCD 带中文注释、本地头 extra 字段、数据描述符（bit3，本地头 size=0）、stored 文档、单引号属性、`opf:` 前缀命名空间、`%20` 转义 + `./`/`../` 路径解析、`properties="cover-image"` 封面定位
- API 实测（curl，均符合预期）：
  - `POST` txt → `{"ok":true,"id":"cmwq3gy310000q0ibag3oldbu","name":"我的江湖往事","chapters":5}`；GBK txt / epub / 刁钻 epub 同样 200
  - `POST` 250 章大书 → `chapters:250`，DB 计数 250（分批 createMany 验证）；21MB 文件 → 400 `文件太大`；`.pdf` → 400 `仅支持 txt / epub 文件`；空 spine epub → 400 `解析失败：没有读到内容`；非 zip 伪 epub → 500 `不是有效的 zip/epub 文件…`
  - `GET ?bookUrl=…&idx=0/4` → 正确 title/content；idx=999 → 404；无参 → 400
  - `DELETE` → `{ok:true}`，复查 LocalBook/LocalChapter/ShelfBook 均为 0，封面文件已删除；坏参 → 400
- `bunx eslint` 两个文件 0 问题；dev.log 无编译错误，所有请求状态码符合预期
- 测试数据已全部清空（DB 三表 local 计数 0，reading-covers 目录已删）

## 四、过程问题与备忘

1. **ZIP 本地头 extraLen 偏移 bug**（已修）：初版把本地头 extraLen 读到 `lo+30`（把头长 30 与字段偏移 28 记混），导致所有 deflate 条目读空；已修正为 `lo+28` 并在 hexdump 复核后全量回归。
2. **dev server 内存里的 Prisma client 过期**：dev server 06:04 启动，而 LocalBook 模型 07:24 才推库重生 client，运行中的 `@/lib/db` 全局单例没有新模型的 delegate（`db.localBook` undefined → 首次 POST 报 `Cannot read properties of undefined`）。**解法：`touch next.config.ts` 触发 Next dev 全量重启**（日志出现 "Found a change in next.config.ts. Restarting the server…"），未改任何文件内容。后续任何 agent 新增 Prisma 模型后如果 dev server 是旧的，照此办理即可。
3. epub 的 OPF 用正则解析（无 XML 库依赖，按任务要求）；章节正文转纯文本复用 `engine.ts#htmlToText`（cheerio 实体解码）。
4. 偏差说明：txt 章节标题行未做句末标点过滤（严格按任务给的 ≤60 字整行规则实现）；其余均按规格。
5. 测试脚本与样本在 `/home/z/local-import-tests/`（项目外，可随时删）：`make-samples.ts` / `make-samples2.ts`（造样本，含手写 zip 构建器）、`test-parse.ts` / `test-tricky.ts`（单测）、`check-db.ts`（DB 验证）、`debug-zip.ts`（zip 结构 dump）。
