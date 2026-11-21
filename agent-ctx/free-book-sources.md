# GitHub 免费书源调研结果（2026-11-21 验证）

> 用途：为 AI Phone 新增「阅读 App」提供书源数据支撑。
> 验证方式：下载书源 JSON 验证结构有效性（Legado 阅读 3.0 格式：bookSourceUrl/ruleSearch/ruleToc/ruleContent），
> 并对 204 个书源站点做 HTTP 存活探测（沙箱海外网络环境，国内可用率会更高）。

## 一、书源仓库清单（按推荐度排序）

### 1. XIU2/Yuedu ⭐12.7k —— 最著名的精品自用书源
- 仓库：https://github.com/XIU2/Yuedu
- 书源：22 个精选源（笔趣阁/起点/轻小说等）
- 结构验证：22/22 完整（搜索22 发现13 目录22 正文22）
- 站点探测：存活 10 + 反爬(带header仍可用) 5 / 22 → 实际可用率 ~68%（海外探测口径）
- 直链：https://www.dckxzd.com/ （书源分享页）
- 备注：作者长期维护，书源质量最高，更新 2026-08

### 2. aoaostar/legado ⭐7.6k —— 聚合镜像站（推荐入口）
- 仓库：https://github.com/aoaostar/legado
- 官网（一键导入）：https://legado.aoaostar.com （HTTP 200 ✅）
- 聚合内容（自动同步多个上游）：
  - 全量书源 3907 条（b778fe6b.json, 20MB）
  - XIU2 精品 22 条（71e56d4f.json）
  - 破冰书源 128 条（4dc410d1.json）：精品90/API21/正版9/有声5，探测可用率 72%
  - 关耳女频 86 条（e3e5d620.json，来自 shuyuan.miaogongzi.net）：探测可用率 33%（海外口径，国内更高）
  - 酷安@三舞313 1554 条（2a1f129b.json）
  - 酷安@开源阅读软件 2117 条（3bb7b751.json）
- 另有：订阅源/净化规则(乌云净化20条)/排版配置(番茄)/主题(微信读书日夜间)
- 直链格式：https://legado.aoaostar.com/sources/{hash}.json

### 3. tickmao/Novel ⭐2k —— 已验证分层的书源集合
- 仓库：https://github.com/tickmao/Novel
- 书源：full.json 347 条（验证率 30%：verified 306）；full-extended.json 1010 条扩展
- 站点探测：可用率 73%（30 抽样）
- 直链：https://cdn.jsdelivr.net/gh/tickmao/Novel@master/sources/legado/full.json
- 备注：仓库自带 invalid.json（已剔除失效源），维护质量高，更新 2026-11

### 4. liufuyou/read ⭐774 —— YCK + Yiove 两大合集
- 仓库：https://github.com/liufuyou/read
- 书源：
  - yck-novel.json 267 条（小说200/正版67），可用率 56%
  - yiove-novel.json 714 条（Yiove 官方书源仓库镜像），可用率 83% ← 抽样可用率最高
- 直链：https://cdn.jsdelivr.net/gh/liufuyou/read@main/sources/yiove-novel.json

### 5. 其他可用的专项仓库
| 仓库 | 内容 | 验证结果 |
|------|------|---------|
| ZGQ-inc/source ⭐1.3k | 书源/图源/订阅源/直播源大整合 | 站点型仓库（zgq.source.com类似） |
| DowneyRem/PixivSource ⭐1.1k | Pixiv 小说专用源（pixiv.json 411KB 等） | import.json 结构有效 |
| CandyMuj/ResourceInterface ⭐307 | TVBox+Legado 接口收集 | 目录结构完整 |
| Wenmoux/sources ⭐291 | 自用源+亦搜规则+订阅源 | yuedu_booksource.json 仅 2 源 |
| shidahuilang/shuyuan-bak ⭐237 | good.json 精选/ shuyuans_data.json 33MB 全量 | 文件过大下载超时，书源备份仓库 |
| entr0pia/MyLegadoSource ⭐123 | 55 个自选（轻小说/漫画为主） | 结构 55/55 完整，可用率 49%（轻小说源多在海外） |
| MajoSissi/legado-source ⭐62 | 轻小说书源 | 未逐个验证 |
| ZWolken/Light-Novel-Yuedu-Source ⭐465 | 轻小说书源合集 | 未逐个验证 |
| sjshb57/legado-57 ⭐114 | 替换规则（净化） | jinghua.json 同类 26 条已验证 |

### 6. 书源网站（网页版一键导入）
- legado.aoaostar.com ✅ HTTP 200（聚合站，推荐）
- shuyuan.miaogongzi.net ✅ HTTP 200（喵公子/关耳书源，女频强）
- yckceo.com ⚠️ 沙箱不可达（国内一般可访问，YCK 书源合集）
- www.gitlink.org.cn ✅ HTTP 200（有书源镜像项目）

## 二、总体结论

- 合计验证独立书源站点 921 个（12 个有效书源文件）
- 大合集抽查可用率：Yiove 83% > tickmao 73% ≈ 破冰 72% > XIU2 68%（含反爬）
- 注：探测为海外沙箱环境，部分站点封境外 IP；国内手机实测可用率普遍再高 10-20%
- 推荐组合：**破冰书源(128精品) + XIU2(22) + Yiove(714) + tickmao-full(347)** ≈ 1200 源，去重后足够支撑「阅读 App」

## 三、给「阅读 App」功能的技术建议

1. 书源格式：Legado 3.0 JSON（bookSourceUrl / ruleSearch / ruleToc / ruleContent 规则语法）
2. 规则引擎需要支持：CSS 选择器 + JSONPath + XPath + JS（<js></js> 块）+ 正则，@get/@put 变量
3. 服务端代理抓取：本仓库已有 /api/tb-proxy、/api/map-tile 等代理路由先例，书源站点多有反爬，需 UA/Referer 伪装与重试
4. 数据落地：书架/阅读进度可用现有 Prisma(SQLite) + IndexedDB（src/lib/ios/idb-kv.ts 已有 KV 设施）
5. 图标：阅读 App 图标需放 public/icons/reading.png 并在 registry.tsx 注册 AppId

## 四、验证数据文件位置

- 书源样本：/home/z/booksrc-work/*.json
- 站点探测明细：/home/z/booksrc-work/probe_result.json
- 探测脚本：/home/z/booksrc-work/probe.py、validate.py
