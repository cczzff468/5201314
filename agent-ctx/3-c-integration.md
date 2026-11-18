# Task 3-c 工作记录：Mobile Agent 集成接线（autonomy × agent × 五聊天端）

执行代理：3-c-integration
日期：2026-11-08（v1.5.0 Mobile Agent）
状态：✅ 完成（tsc 目标文件零输出 / eslint 目标文件零新增错误，存量错误已用 stash 基线法逐一核实非本次引入 / dev server 编译通过 GET / 200）

## 改动清单

| 文件 | 动作 | 关键行号（改后） | 内容 |
|---|---|---|---|
| `src/lib/ios/shizuku-agent.ts` | 追加 B5+ 节 | L665-703 | 补 2 个单步导出：`agentInputText(text)`（复用 stepInputText：ASCII→labInputText 直输、中文→nativeInputChinese；**非任务态输入完立即 nativeRestoreIme 还原 IME**，任务运行中交给任务 finally）、`agentClickText(target)`（agentObserve→findClickableByText→labTap，返回 false 时调用方降级 VLM） |
| `src/lib/ios/shizuku-autonomy.ts` | 6 处修改 | L73 / L181,185 / L70 / L234-239 / L486,503-520,554-561,590-610,705 / L733,743 | ① AUTONOMY_CAPS hands 组「打开应用」后加 `agent` 项（无 danger，总开关开即默认开）；② CAP_SYNTAX 加 `agent` 语法、`type` 语法改中文支持；③ type 项 desc 去「系统限制仅英文数字」；④ buildShizukuAutonomyRules 在【多步任务】后插入条件教学块（仅 `cfg.caps['agent']===true`）；⑤ executePhoneOp 加 `progress?` 第二参 + case '输入' 走 agentInputText + case '点文字' UI 树优先/VLM 降级 + 新 case 'agent'/'智能体'（gate：agent 开关全开 + open/tap/type/key 全开）+ default 命令清单加 agent；⑥ enqueuePhoneOp 第三参 progress 透传 executePhoneOp（队列间隔逻辑未动：agent 不在 UI_TOUCH_CMDS，走 OP_GAP_MS） |
| `src/components/apps/wechat.tsx` | 接线 | L6633-6648 | enqueuePhoneOp 第三参 onProgress：写 `kind:'sys', sys:{text}`（**无 op 字段**）纯展示行，saveMsgs+appendWithBoundary+setMsgs 照抄结果行惯例 |
| `src/components/apps/chat.tsx` | 接线 | L1689-1697 | 同上，消息形制照本端（无 kind 字段、role:'assistant'、`as unknown as ChatMsg`、loadMsgs(storageKey) ?? []） |
| `src/components/apps/qq.tsx` | 接线 | L4926-4934 | 同上（role:'peer'、kind:'sys'、`as unknown as QQMsg`） |
| `src/components/apps/qq-group.tsx` | 接线 | L3011-3020 | 群端消息形制是 `kind:'notice', noticeText`（非 sys！）：进度行 noticeText=「〔智能体〕…」**不以「手机操作」开头**，`id: ${aiMsgId}-agent-${Date.now()}-${agentSeq++}`（本地计数器防同毫秒撞 id），saveGroupMsgs+mountedRef 守卫照抄结果行 |
| `src/components/apps/wx-group.tsx` | 接线 | L3422-3431 | 同 qq-group |
| `src/lib/app-version.ts` | bump | L14-16, L27-36 | APP_VERSION='1.5.0'、APP_VERSION_CODE=9、APP_RELEASE_NOTES 头部插 1.5.0 条目（4 项，date 2026-11-08，与现 1.4.3 条目同日期——按任务给定模板） |
| `src/lib/ios/call-followup.ts` | 存量 tsc 修复 | L47-48 | `CallFollowupContact` 补 `customRules: string | null`（详见「偏离 2」） |

## 五端序列化核查结论（op:false / 非 op 进度行确实不回喂 AI）

| 端 | 进度行形制 | 回喂闸门（读码确认） | 结论 |
|---|---|---|---|
| wechat.tsx | `kind:'sys', sys:{text}`（无 op） | L7213 基础过滤：sys 行仅放行 `m.sys?.pat \|\| m.sys?.op`；L7335-7337 序列化仅 `sys?.op` 转「（内部反馈…）」 | ✅ 双重排除，进度行连 history map 都进不去 |
| chat.tsx | `sys:{text}`（content=''，无 op） | L1862 过滤：`m.content \|\| m.sys?.op \|\| kind==='voice' \|\| …`；L1887 仅 `sys?.op` 转内部反馈 | ✅ content 空 + 无 op → 被过滤 |
| qq.tsx | `kind:'sys', sys:{text}`（无 op） | L5300 基础过滤同微信（sys 仅放行 pat/op）；L5399-5404 仅 `sys?.op` 转内部反馈 | ✅ |
| qq-group.tsx | `kind:'notice', noticeText:'〔智能体〕…'` | L2664 过滤：`m.kind !== 'notice' \|\| (m.noticeText ?? '').startsWith('手机操作')` 才进上下文；L2421 msgTextOf 仅 noticeText 以「手机操作」开头转内部反馈 | ✅ 「〔智能体〕」前缀保证不以「手机操作」开头（该前缀在 autonomy 的 case 'agent' 统一加，群端无需各自处理） |
| wx-group.tsx | 同 qq-group | 过滤逻辑同构（L3014 附近 msgTextOf / runCharTurn 过滤） | ✅ |

最终结果仍走各端原有 `手机操作成功/失败：…`（sys.op:true / noticeText 以「手机操作」开头）结果行回喂 AI，与 v1.3 闭环一致。

## 质检结果（原样）

- `bunx tsc --noEmit 2>&1 | grep -E "shizuku-autonomy|shizuku-agent|shizuku-lab|wechat|chat\.tsx|qq|wx-group|app-version"` → **零输出**（grep exit 1）
- eslint（8 个目标文件 + call-followup.ts）：
  - `shizuku-autonomy.ts` `shizuku-agent.ts` `app-version.ts` `call-followup.ts` → **零输出 exit 0**
  - `wechat.tsx` → **零输出 exit 0**；`qq.tsx` → **零输出 exit 0**
  - `chat.tsx` → 15 errors / `qq-group.tsx` → 52 errors / `wx-group.tsx` → 18 errors —— **全部为存量基线错误**（react-hooks/set-state-in-effect、refs-during-render、preserve-manual-memoization）。已用 `git stash push` 三文件 → lint 基线 → `git stash pop` 核实：基线计数完全相同（15/52/18），本次改动**零新增**；错误行号（chat 1201~5239、qq-group 843~5203、wx-group 同构）均不在本次改动区
  - 注：8 个大文件合跑一次 eslint 会 OOM（node 堆 2G 默认 → Killed），需 `NODE_OPTIONS=--max-old-space-size=6144` 且分批跑
- dev.log：✓ Compiled in 1292ms，GET / 200，无编译错误

## 与任务书的偏离（均已确认理由）

1. **shizuku-agent.ts 补了 2 个小导出**（agentInputText / agentClickText）：3-b 未导出任务书假想的这两个函数。按任务书「点文字」处的预案精神（就地用 agentObserve+findClickableByText+labTap 组合），选择在 agent 层补薄封装而非在 autonomy 内联——理由：inputChinese 的 IME 还原逻辑（originalIme 模块级状态）在 agent 层，内联会把 native-perception 输入机制复制进 autonomy；且两文件已互引（agent→autonomy 静态、autonomy→agent 动态 import），内联不减少环。autonomy 内的 case 代码与任务书片段逐字一致（含 `await import('./shizuku-agent')`）。
2. **修了 call-followup.ts 存量 tsc 错误**：`CallFollowupContact` 缺 `customRules` 字段而 chat.tsx L496（基线代码，非本次改动区）与 phone.tsx/chat-call.ts/proactive-call.ts 所有调用方都传它、服务端 followup route 也消费（与 turn API InlineContact 同形）——不修则任务书 tsc 门禁（chat.tsx 零输出）无法达成。同 3-b 修 native-perception L431 的先例。
3. **runAgentTask 进度接线用 `onEvent` 而非任务书片段里的 `onProgress`**：3-b 实际签名是 `onEvent?: (e: AgentEvent) => void`。过滤规则：say/step/stepfail/danger 四类非终态事件透传给 progress（统一加「〔智能体〕」前缀落纯展示行）；done/fail/stopped 是终态、文本已由返回值走结果行回喂，不重复播。
4. **type 能力 desc 任务书要求的文案照抄**；CAP_SYNTAX.type 同步替换；buildShizukuAutonomyRules 内未发现其他「中文输不了」旧文案（仅 runPlaySong 注释里有一句历史缘由说明，属代码注释非教学文案，保留未动）。

## 遗留风险

1. **三端存量 eslint 错误（chat 15 / qq-group 52 / wx-group 18）**：全是 react-hooks 新规（setState-in-effect / refs-during-render / memoization-preserve）对老代码的存量告警，与本次无关但门禁字面要求「零 error」无法在不做大规模重构的前提下达成——建议后续单开任务治理。
2. **群端进度行展示依赖 notice 渲染通道**：与「正在操作手机（cmd）…」占位行同通道，若某端 notice 渲染有长度截断，长步骤文案可能被截（纯展示，不影响回喂）。
3. **点文字 UI 树路径无独立能力开关**：uiautomator dump 属只读且仅在被 tap 能力 gate 的「点文字」内使用，未单设开关（与任务书一致）；旧 APK 壳无 dumpUi 桥时 agentObserve 返回 ok:false → 自动降级 VLM 路径，向后兼容。
4. **agent 任务与单步命令共队列**：runAgentTask 内部每步有自己的落定间隔，执行完外层队列再等 OP_GAP_MS(1.2s)，无竞速风险；但 agent 运行中若用户在别的会话再发手机操作，会排队等 agent 结束（串行语义，符合预期）。
5. **release notes 日期**：按任务书模板写死 2026-11-08（与现 1.4.3 条目同日期）；如需与真实发布日对齐，改 `src/lib/app-version.ts` L29 一处即可。
