# Task 4-a 工作记录：Mobile Agent 智能体核心增强（A1 动作原语 × A2 视觉验证 × A6 坐标缓存）

执行代理：4-a-agent-core
日期：2026-11-09（v1.6 Agent 核心增强，基线 commit afa6437 v84）
状态：✅ 完成（tsc 目标文件零输出 / eslint 三目标文件零输出 exit 0 / dev server 强制重编译通过 GET / 200 无新增报错）

## 改动清单

| 文件 | 动作 | 关键行号（改后） | 内容 |
|---|---|---|---|
| `src/lib/ios/shizuku-agent.ts` | 追加+改（1118→1583 行） | 头注释 L24-32 | v1.6 设计说明：三项增强的机制与护栏一句话总览 |
| 同上 | import | L54, L59 | shizuku-lab 增 `labScreencap`；shizuku-autonomy 增 `visionAsk`（静态导入，与既有 AUTONOMY_CAPS 同通道，autonomy→agent 仍为动态 import，无新环） |
| 同上 | ACTION_CAP 补 3 项 | L460-462 | `longPress:'tap'` / `doubleClick:'tap'` / `drag:'swipe'` |
| 同上 | 屏幕分辨率任务级 memo | L478-486 | `screenSizeMemo` + `agentScreenSizeMemo()`（A6 换算专用，任务开始清空；scroll 等语义滑动仍走原 `agentScreenSize` 现查，行为不变） |
| 同上 | 新增 B5a 节（A6 坐标缓存） | L529-724 | `COORD_CACHE_KEY='agent-coord-cache-v1'`、上限 120 LRU、`normalizeTargetText`（小写 trim+压空白）、`fgPackageOf`（从「前台应用：com.x.y」/mCurrentFocus 行抠包名）、`currentFgPackage`（dumpsys window 轻查）、load/save/lookup/bumpHit/drop/record 六个缓存原语（**读写全 try-catch，window 判空**）、`tryClickViaCoordCache(target, longPressMode)` 命中快速路径：命中→归一化坐标换算真实 px→labTap/原地 swipe 800ms→UI 树轻量复核（目标元素已消失/仍在原地/UI 树读不了 → 信任点击 hits+1 返回「坐标缓存命中」；命令失败或元素挪位超屏对角 8%（`COORD_CACHE_STALE_RATIO=0.08`）→ 弃条目返回 null 由调用方**同一调用内回落正常 dumpUI 路径**） |
| 同上 | stepClickElement 重写 | L726-754 | 前置 `tryClickViaCoordCache(t,false)`；正常 dumpUI 路径成功点击后写缓存（app 取自本次 `obs.fg` 前台行，**不多一次 dump**；分辨率走 memo）；tap 失败语义与原版一致 |
| 同上 | 新增 3 个动作执行器 | L810-904 | `stepLongPress`：文字目标（缓存快路径→UI 树 findClickableByText，同 clickElement）或 "x,y"，执行 `input swipe x y x y 800`；`stepDoubleClick`：文字/坐标定位后两次 labTap 间隔 100ms（window.setTimeout）；`stepDrag`：正则解析 "x1,y1,x2,y2[,durationMs]"（支持全/半角逗号），默认 700ms、钳 100~10000，执行 labSwipe |
| 同上 | execAgentStep | L978-989, L1000 | 新 case longPress/doubleClick/drag（按 ACTION_CAP 查 isCapEnabled 硬拦截）；default 未知动作提示清单补齐 13 个动作 |
| 同上 | AGENT_ACTIONS_DOC | L1085-1088 | 教学表加 11/12/13 三行：长按（弹菜单/副选项，args 同 clickElement）、双击（点赞/快进）、拖拽（进度条/滑块/排序，"x1,y1,x2,y2[,毫秒]" 默认 700） |
| 同上 | ACTION_ALIASES | L1151-1157 | 防御性别名：long_press/长按→longPress、doubleclick/double_click/双击→doubleClick、拖拽/拖动→drag（LLM 小写化输出兜底） |
| 同上 | 新增 B6b 节（A2 视觉验证） | L1256-1343 | `AGENT_VISUAL_VERIFY=true` 模块级总开关；`VISUAL_VERIFY_ACTIONS` 9 个状态变更动作（openApp/clickElement/tapPoint/inputTextToFocus/pressEnter/back/longPress/doubleClick/drag）；`VISION_VERIFY_TIMEOUT_MS=15s` 看门狗；`VISION_FAIL_STREAK_LIMIT=3` 连败停用；`visionVerifyAsk`（任务全文+本步意图+why → 严格 JSON {"ok","note"}，拿不准判 true 防误杀）；`visualVerifyStep(task, step, vst)`：labScreencap→visionAsk→extractJsonObject 容错解析；verdict=true 静默通过 / verdict=false 返回 ok:false StepResult（text=「视觉验证未通过：<note>…」）/ 截屏失败·接口失败超时·输出不可解析 → failStreak++ 且返回 null（**信任 UI 树结果继续，绝不中断任务**）；连败≥3 → vst.disabled=true 本任务停用；gate 链：总开关→本任务停用旗标→动作集合→`isCapEnabled('screencap')`（「看见·看屏幕」开关即截屏授权） |
| 同上 | UI_TOUCH_ACTIONS | L1364-1375 | 补 longPress/doubleClick/drag → 步间落定走 UI_SETTLE_MS(2s) |
| 同上 | runAgentTask | L1428-1429, L1534-1545 | 初始化：`screenSizeMemo=null` + `visionCtl={failStreak:0,disabled:false}`（任务级，每次运行新建）；逐步执行循环：**先 settleAfterStep 落定再视觉复核**（避免截到转场动画中间态）→ `visualVerifyStep` 判未通过则 push ok:false history 条目 + emit('stepfail') + break → 走既有失败→重规划路径（「视觉验证未通过」文本自然进 history，planWithLLM 无需特判）。**runAgentTask 签名、AgentEvent 类型零改动** |
| `src/lib/ios/shizuku-autonomy.ts` | 2 处（754→763 行） | L249-274 | phoneVision 加 `timeoutMs=90_000` 可选参（AbortSignal.timeout 动态化，既有调用行为不变）；新增 `export async function visionAsk(image, ask, timeoutMs=90_000)` 薄出口（Agent 验证专用：15s 看门狗语义在 agent 侧传入） |
| 同上 | 教学块 | L236 | 【智能体模式·多步真实任务】补充规则追加 ④：智能体掌握长按（弹菜单/呼出副选项）、双击（点赞/快进）、拖拽（进度条/滑块/排序）进阶手势，自行规划使用、聊天 AI 无需拆解 |
| `src/lib/ios/native-perception.ts` | **零改动** | — | 截屏复用 labScreencap（nativeShizukuScreencap 专用 AIDL 通道）即可，无需新增桥方法 |

## 质检结果（原样）

```
=== TSC GATE ===
$ bunx tsc --noEmit 2>&1 | grep -E "shizuku-agent|shizuku-autonomy|native-perception"
(无任何输出)
(grep exit=1 — 1=零输出)

=== ESLINT GATE ===
$ NODE_OPTIONS=--max-old-space-size=6144 npx eslint src/lib/ios/shizuku-agent.ts src/lib/ios/shizuku-autonomy.ts src/lib/ios/native-perception.ts
(无任何输出)
(eslint exit=0)

=== DEV LOG ===
✓ Compiled in 779ms / ✓ Compiled in 949ms / ✓ Compiled in 822ms（最后一次为 touch 两文件强制重编译后）
GET / 200（多次），无编译错误；无新增 error 行
```

文件规模：shizuku-agent.ts 1118→1583 行；shizuku-autonomy.ts 754→763 行；native-perception.ts 0 改动。工作树仅这 2 个文件被修改（`git status` 确认；另有他人遗留未跟踪文件 `src/components/apps/lint-probe.tsx`，未碰）。

## 与任务书的偏离 / 设计裁量（均已注明理由）

1. **视觉验证的动作集合严格取任务书显式列举的 9 个**：任务书括号内列举了 openApp/clickElement/tapPoint/inputTextToFocus/pressEnter/back/longPress/doubleClick/drag 共 9 个（13 个动作减 wait/lookScreen/pressDelete 后 scroll 也不在其中）。按字面取 9 个、**scroll 不做视觉复核**（任务书「不含」清单虽只点名 wait/lookScreen/pressDelete，但显式枚举清单优先；scroll 失败由下一步观察/lookScreen 自然兜住，复核收益低还多耗 15s 看门狗预算）。若需放开，往 `VISUAL_VERIFY_ACTIONS` 加一行 'scroll' 即可。
2. **验证时机放在 settleAfterStep 之后**：任务书说「逐步执行后」加验证层，未指明与步间落定等待的先后。选择先落定（openApp 3.5s / UI 操作 2s）再截屏——否则会截到转场动画中间态，产生系统性误判。
3. **A6 命中复核的判定口径**：任务书要求「走标准步骤验证（UI 树或 A2 视觉层）确认 → 失败弃条目回落」。因回落要求发生在「同一调用内」而 A2 视觉层在主循环（跨调用），故命中复核用**调用内轻量 UI 树复核**，判定规则保守偏信任：目标元素从树里消失=点击已导航走→成功；元素仍在原地=驻留类按钮→信任；元素挪位超屏对角 8%=布局已变=缓存过期→弃条目回落正常 dumpUI 路径；UI 树读不了（游戏/视频全屏）→信任（主循环 A2 视觉层兜底）。深层验证仍由 A2 在主循环做（clickElement/longPress 都在复核集合里）。
4. **写缓存路径的分辨率来源**：任务书说 app 取自 agentObserve/现有前台来源、别多一次 dump——已照做（obs.fg）；分辨率额外加了**任务级 memo**（agentScreenSizeMemo，runAgentTask 开始时清空），避免每次成功点击都多一次 getScreenResolution 原生桥往返（命中路径与写路径共用）。
5. **任务书背景里写的「visionAsk 视觉底座」实际函数名是 phoneVision（未导出）**：按任务书命名补了 `export visionAsk` 薄出口（内部转发 phoneVision，唯一差异是超时可调），agent 侧静态导入；phoneVision 原签名加可选参（默认 90s），runPlaySong/runPointAtText/runLookScreen 三个既有调用零感知。
6. **视觉验证失败在 history 里落两条记录**（「执行 X → 成功：已点击…」+「执行 X → 失败：视觉验证未通过：…」）：保留命令成功但画面存疑的完整因果给重规划 LLM（比单条覆盖信息量大）；HISTORY_MAX_ENTRIES=24 上限天然控制 token。
7. **doubleClick 双击间隔用普通 window.setTimeout(100ms) 而非 sleepStoppable**：100ms 远小于任何有意义的急停响应粒度，两次 Shizuku 调用合计 <300ms，不值得引入分片轮询。
8. **ACTION_CAP 表**：该表在现码中是文档性 gate 对照表（switch 里实际用 isCapEnabled 硬拦截），按任务书要求同步补了 3 项，未改既有结构。

## 遗留风险

1. **A2 误杀可能**：VLM 对「预期结果」的理解依赖画面证据，个别场景（如弹窗已被立即自动关掉、异步加载未完成）可能误判 not-ok 触发多余重规划；已用「拿不准判 true」的提示词偏置 + note≤30 字约束缓解，实测如误杀率高可一键 `AGENT_VISUAL_VERIFY=false`。
2. **视觉验证加长单步时延**：状态变更步骤成功后最多 +15s（看门狗）；接口正常时通常 3~6s。连败 3 次后自动回到纯 UI 模式，最坏情况有界。
3. **坐标缓存的 stray-tap 风险**：缓存过期回落路径里，过期坐标的那一击可能点中别处（随后正常路径再点正确目标）；已在「元素挪位超 8%」判定+弃条目下尽量收敛，且 UI 树读得到的场景第一击后即可识别。同文本多实例（两个「确定」）场景 findClickableByText 的固有歧义与正常路径一致。
4. **缓存跨输入法/主题无感知**：key 是「包名+目标文本」，布局大改版（App 更新换 UI）靠 8% 挪位判定与 A2 复核自然失效，无需版本号。
5. **群端/聊天端接线零改动**：本任务纯库层，agent 事件流（say/step/stepfail/danger）形制未变，Phase 2 各端与 AgentRunnerBar 无需适配；「（视觉复核…）」只改 stepDesc 展示态，不产生新事件类型。
