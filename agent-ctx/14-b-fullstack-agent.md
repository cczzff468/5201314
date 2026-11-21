# Task 14-b · B1 长期记忆图谱（用户画像事实层）

Agent: Z.ai 全栈开发代理（14-b）
日期：2026-10-26（沙箱时间）

## 职责范围
在三层记忆（碎片→核心→长期）之上新增结构化「画像图谱」层：提取（服务端 LLM）/ 注入（聊天 system）/ 记忆库第五 Tab。

## 改动文件
1. `src/lib/memory-core.ts`（+46 行）
   - `MemProfileCategory`（like/dislike/habit/identity/date）+ `MEM_PROFILE_CATEGORIES`（固定顺序：身份→喜好→忌讳→习惯→重要日子）+ `MEM_PROFILE_CATEGORY_LABEL`
   - `MemProfileFact`：{ id, contactId, category, topic, content, sourceFragmentIds?, weight, createdAt, updatedAt, editedAt? }（editedAt 为手动编辑保护标记）
2. `src/lib/memory.ts`（+~320 行）
   - 存储：`mem-profile:<contactId>`（IndexedDB kv，与三层记忆同层 + 账号作用域后缀）；`memPurgeContact` 级联清理
   - API：`listProfileFacts` / `upsertProfileFact`（合并：同 contactId+category+topic 归一化键更新覆盖，保留最早 createdAt、权重取高、来源碎片合并去重；跨类别翻转合并——同 topic 在别的分类下存在视为演进改写 category，防「辣:能吃微辣→不怎么碰辣」新旧矛盾并存；手动编辑过 editedAt 的事实自动提取不覆盖 content；单联系人上限 60 条，超出按低权重→updatedAt 旧淘汰）/ `updateProfileFact` / `deleteProfileFact` / `profileRecallBlock`
   - `profileRecallBlock`：按五类分组紧凑行（`- 忌讳：不吃香菜`），权重→updatedAt 取前 20 条 + 1100 字符预算，空返回 ''，全 try/catch
   - 提取挂钩：`memAfterAiTurn` 异步管线在核心总结之后、长期总结之前插入 `memProfileAutoExtract`（与碎片提取同一节奏；独立 profileInflight 防并发；失败 console.warn 静默）；`callMemoryApi` op 扩 'profile'
   - 手动：`memProfileExtractNow`（memMostRecentApp 取最近对话，抛错给 UI toast，与 memExtractNow 同款交互）
3. `src/app/api/memory/profile/route.ts`（新文件，服务端）
   - POST { conversation, userName, peerName, existing?, config? } → { facts: {category, topic, content, weight}[] }（0-6 条）
   - completeWithFallback / extractUpstreamConfig / parseLooseJSON（与 extract 路由同模式：用户 API 配置优先 → z-ai-web-dev-sdk 兜底）
   - prompt：只提取稳定事实五类、topic=合并键（同一事物沿用旧 topic 才能覆盖旧值）、content 自含主语 25 字内、一次性事件/临时安排忽略、禁代称（视角统一）
4. `src/components/apps/chat.tsx`（+7 行）
   - import profileRecallBlock；memoryBlock 之后 `const profileBlock = memContactId ? profileRecallBlock(memContactId) : ''`
   - baseSys 数组 memoryBlock 后插入 profileBlock（并列注入）
5. `src/components/apps/couple-home/companion-memory.ts`（+9 行）
   - cabinMemoryBlock 追加 profileRecallBlock 块（召回块后、最近互动摘要前）；**未改 CoupleHome.tsx**（cabinMemoryBlock 被其调用，注入自动生效）
6. `src/components/apps/memory-bank.tsx`（+266 行）
   - MemTab 加 'profile'；tabs 加 ['profile', Fingerprint, '画像图谱']；Dock grid-cols-4→5
   - 统计行加「N 条画像」胶囊；ProfileTab（顶部「立即提取画像」按钮 loading 态 + 五类分组卡片 max-h-96 overflow-y-auto 细滚动条 + 条数徽章 + 空态）；ProfileFactRow（topic+content+手动/重要/来源碎片徽章+更新时间，行内编辑 textarea + 两步删除确认）
   - 四个既有 Tab 行为零改动（共享组件未动）

## 数据与合并策略要点
- 合并键：`category::topic`（topic 去空白小写归一化）；键不存在时回落 topic-only 匹配（跨类演进）
- 容量：60 条/联系人，淘汰序 = 权重低 → updatedAt 旧（排序副本算淘汰集合，不破坏原顺序）
- 注入预算：20 条 / 1100 字符（正常到不了预算，双保险）

## 验证证据（全部通过）
- `bunx tsc --noEmit`：仅 next.config.ts(15,5) 既有基线错误，0 新增
- eslint：memory.ts/memory-core.ts/companion-memory.ts/profile route 0 问题；memory-bank.tsx 1 处 = 既有基线（memSweepExpiry effect，与 HEAD 逐字相同）；chat.tsx 15 处 = 既有基线（stash 对比同为 15）
- curl POST /api/memory/profile：① 无 existing → {facts:[{habit,熬夜,熬夜到凌晨1点},{dislike,香菜,不能吃香菜,high},{like,辣,能吃微辣},{date,生日,周六是生日,high}]}；② 带 existing（like·辣）→ 模型沿用 topic「辣」输出 dislike「不怎么碰辣」+ identity/职业 + dislike/芒果（过敏 high）——更新对照与权重分类符合预期
- agent-browser 390×844 E2E：锁屏上滑解锁 → 主屏第 3 页打开记忆库 → 详情页 5 Tab（mem-tab-frag*/ltm/long/profile/set）→ 画像 Tab 空态 + 按钮 → IndexedDB 播种联系人「小雪」+ 信息聊天记录 → 「立即提取画像」loading（正在提取…）→ 12s 后五类分组卡片落库（职业/城市/川菜/香菜/熬夜/生日 6 条，香菜=high 重要徽章）→ 行内编辑香菜内容保存（手动徽章出现）→ 两步删除川菜（喜好组计数归零自动隐藏）→ 二次提取：手动编辑过的香菜未被覆盖、同 topic 合并无堆叠、createdAt 保留 → 信息 App 与小雪对话「明天中午我们一起吃什么好？」→ AI 回复「**微辣，不要香菜，正好你也喜欢**」（画像注入端到端生效）→ 控制台无错误
- dev.log：`POST /api/memory/profile 200 in 4.1s`；无新增编译/运行错误（instrumentation Edge 警告为既有基线）

## 遗留问题 / 建议
- 画像提取目前挂钩 memAfterAiTurn（四 App 私聊+群聊+电话通话+小屋全覆盖）；qq.tsx / wechat.tsx 的 system 拼接走各自 memChatRecallBlock，未并列加 profileRecallBlock（任务指定 chat.tsx + companion-memory.ts 两处；如需 wx/qq 也感知画像，按 chat.tsx 同款两行接入即可）
- 画像与三层记忆的跨层矛盾（长期记忆「爱吃辣」vs 画像「不吃辣」）不做硬同步，靠注入提示「人是在变化的」兜底；可在后续版本把画像变化回写为碎片
- 测试数据（联系人 test-14b-xiaoxue + 6 条画像）留在 agent-browser 无头浏览器 IndexedDB 中，不在项目数据里，不影响仓库
