# Task 3-b 工作记录：Mobile Agent 前端核心层（shizuku-agent + 全局 UI）

执行代理：3-b-frontend-agent
日期：2025-01（v1.5 Mobile Agent）
状态：✅ 完成（tsc 目标文件零错误 / eslint 四文件零输出 / dev server 编译通过）

## 交付物

| 文件 | 动作 | 行数 | 内容 |
|---|---|---|---|
| `src/lib/ios/native-perception.ts` | 追加（L890-1012）+1 处存量 tsc 修复（L431） | 1012 | 9 个 Agent 桥封装（executeShell/getScreenResolution/dumpUi/inputChinese/restoreIme/agentShouldStop/agentResetStop/agentNotify/agentNotifyEnd），全部照抄 nativeShizukuExec 防御模式（非原生 null、catch null） |
| `src/lib/ios/shizuku-agent.ts` | 新建 | 1078 | B1 状态 store（useSyncExternalStore 整体替换引用）、B2 高危确认 store（Promise 化 + host-mounted flag + window.confirm 兜底）、B3 UI dump 解析器（parseUiXml/summarizeUi/findClickableByText）、B4 agentObserve、B5 execAgentStep（10 动作）、B6 planWithLLM（/api/chat 纯文本流 + extractJsonObject）、B7 runAgentTask 主循环 |
| `src/components/apps/agent-ui.tsx` | 新建 | 164 | AgentRunnerBar（z-[60] 顶部进度胶囊 + 急停钮）、AgentConfirmHost（z-[95] 全屏确认卡）、AgentGlobalLayers 组合导出 |
| `src/components/ios/PhoneShell.tsx` | 小改 | 711 | dynamic import AgentGlobalLayers + `{layersReady && <AgentGlobalLayers />}` 挂在 IncomingCallLayer 之前 |

## 下游代理（尤其 3-c）必读的接口契约

### 1. 能力开关：`agent` cap key（3-c 必须在 AUTONOMY_CAPS 注册）
`runAgentTask` 三道闸读取 `getAutonomyConfig().caps['agent'] === true`。
**当前 AUTONOMY_CAPS（shizuku-autonomy.ts）没有 `agent` key** → getAutonomyConfig 会把它当脏键删掉 → Agent 永远被闸。
3-c 需在 AUTONOMY_CAPS 加 `{ key: 'agent', label: 'Mobile Agent（智能体）', desc: …, group: 'hands' }`（建议 danger:true 默认关，或默认开由 3-c 定）。
另要求 open/tap/type/key 至少三项打开（不足会列入拒绝文案）。

### 2. 导出的 store/UI API（3-c 设置页与聊天入口可直接用）
- `useAgentState(): AgentState`（字段含 running/task/round/maxRounds/stepIndex/stepTotal/stepDesc/narration/finished/ok/summary/stopRequested）
- `agentRequestStop(source: string)`（本地停止旗标；原生急停走通知按钮→每步轮询 nativeAgentShouldStop）
- `requestDangerConfirm(title, detail): Promise<boolean>` / `subscribeDangerRequests(cb)` / `resolveDangerRequest(id, ok)` / `setAgentConfirmHostMounted(bool)`
- `parseUiXml(xml): UiNode[]`、`summarizeUi(nodes, maxLines=70)`、`findClickableByText(nodes, target)`、`agentObserve()`（AgentObservation 额外带 `nodes: UiNode[]`，契约外补充，免二次 dump）、`execAgentStep(step)`、`runAgentTask(task, { onEvent, ctx, maxRounds })`

### 3. 原生壳（APK 侧，对应原生任务的 9 个新插件方法名）
`executeShell{cmd,timeoutMs}`、`getScreenResolution`、`dumpUi`、`inputChinese{text}`、`restoreIme{imeId}`、`agentShouldStop`、`agentResetStop`、`agentNotify{title,text}`、`agentNotifyEnd`。全部走 nativeCall('NativePerception') 协议；旧壳不回包→超时→null→调用方兜底，天然向后兼容。

### 4. runAgentTask 主流程签名（最终）
```ts
runAgentTask(task: string, opts?: {
  onEvent?: (e: { type: 'say'|'step'|'stepfail'|'danger'|'stopped'|'done'|'fail'; text: string }) => void;
  ctx?: { ownerName?: string; persona?: string; memory?: string; peerName?: string };
  maxRounds?: number; // 默认 3，clamp 1~6
}): Promise<{ ok: boolean; text: string }>
```
流程：三道闸（isNativePerception → autonomy master → agent cap + open/tap/type/key≥3）→ 防重入 → 复位旗标+发常驻通知 → 轮循环{观察→planWithLLM→say 播报→空 plan 走 note→逐步执行（每步前双通道停止检查；dangerous 或 DANGER_PATTERNS 命中弹确认卡；失败 stepfail+break 进 replan）}→ 全步成功即完成 → finally{restoreIme/resetStop/notifyEnd/store finished}。

### 5. 动作集（10 个，契约写 11 系笔误；为让"逐字删旧内容"规则可执行补了 pressDelete）
openApp / clickElement / tapPoint / inputTextToFocus / pressEnter / pressDelete / back / scroll(上/下/左/右) / wait(200~10000ms 分片可停) / lookScreen。每步按 ACTION_CAP 查单项开关硬拦截（wait/lookScreen 不设闸）。步间落定：openApp 后 3.5s、UI 类后 2s、其他 0.8s（可被急停打断）。

## 与契约的偏离（已确认理由）
1. **shizuku-agent.ts 保留 `'use client'`**——契约说"不带指令"，但实际 shizuku-lab.ts / shizuku-autonomy.ts 首行都有 'use client'（契约作者记错），随项目惯例。
2. **AgentObservation 增加 `nodes` 字段**——clickElement 免二次 dump（契约未含，性能必要）。
3. **AgentState 增加 `stopRequested`**——急停按钮 loading 态所需。
4. **确认卡用 `absolute inset-0` 而非 `fixed`**——组件渲染在手机壳内，fixed 会铺满整个浏览器视口穿帮；与 IncomingCallLayer(z-84)/GlobalCallLayer 同为壳内定位。
5. **增加 pressDelete 动作**（第 4 点已述）+ ACTION_ALIASES 动作名归一 + plan 步数上限 12。
6. **scroll 分辨率兜底链**：nativeGetScreenResolution → labScreenSize() → 1080x2340（比契约多一层 labScreenSize）。
7. **effConfig**：`{...apiConfig, maxTokens: Math.max(maxTokens, 1500)}`（照抄 chat-stream-store 的抬限模式，防 plan JSON 截断）。
8. **修了 native-perception.ts L431 存量 tsc 错误**（Cap-go 事件 filter 类型谓词不兼容，4 条报错在基线就存在，git stash 验证过；不修则"目标文件零错误"门禁无法达成）。
9. **AgentRunnerBar 淡出实现**用 cycleKey（round#maxRounds#summary）+ 定时器回调 setState，规避 react-hooks/set-state-in-effect 新规则（同步 setState in effect 会报 error）。

## 质检结果（原样）
- `bunx tsc --noEmit 2>&1 | grep -E "shizuku-agent|agent-ui|native-perception|PhoneShell"` → 零输出（exit 1）
- `bunx eslint src/lib/ios/shizuku-agent.ts src/lib/ios/native-perception.ts src/components/apps/agent-ui.tsx src/components/ios/PhoneShell.tsx` → 零输出 exit 0
- dev.log：✓ Compiled in 653ms，GET / 200

## AgentRunnerBar 显隐条件
显示：`st.running === true`（运行中），或 `st.finished && hiddenKey !== cycleKey`（结束后 4s 内展示结果再淡出；cycleKey=round#maxRounds#summary，新一轮任务的结束标识不同会重新显示 4s）。其余（含 idle、淡出后）不渲染，零开销。急停按钮仅 running 时出现，stopRequested 后转「停止中」禁用。
