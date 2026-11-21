# Task 4-b（续）工作记录：存量代码 ESLint 清零（chat.tsx / qq-group.tsx / wx-group.tsx）

执行代理：4-b-eslint-cleanup（续）
日期：2026-11-09
状态：✅ 完成（三文件 eslint 各 0 errors / tsc 三文件零输出 / dev 热编译通过 / 信息 App 冒烟通过）
基线：commit afa6437（v84）工作树上接续上一代理未完成现场

## 接手现场勘察（与任务书差异）

任务书数字已过期（上一代理超时前实际进度更靠前）：
- `chat.tsx`：**已全部修完**（任务书说剩 3 个，实测 eslint exit=0）
- `qq-group.tsx`：**已全部修完**（任务书说 52 个，实测 exit=0）
- `wx-group.tsx`：**修了一半且留雷**——ref 写入 effect 化、runGroupTurnRef 分发、流收尾 setTimeout 合并、running 镜像 state 及其置位都已就位，但：
  1. `running`/`runGroupTurnRef` 声明块被**粘贴了两份**（L2531/L2536 重复 `const [running, setRunning]`、L2533/L2538 重复 `const runGroupTurnRef`）→ tsc TS2451 ×6
  2. render 期读 ref 的收尾没做：canDispatch（L4983）与发送按钮 disabled（L5677）仍读 `runningRef.current`
  3. `setMenuRect` 闭包前向引用（L4543）未做声明上移

> ⚠️ 质检手段备注：本会话 Bash 通道曾出现输出吞字（连续两字符 `[m` 被吞，如 `[menuRect` 显示成 `enuRect`）及早期 eslint 结果显示不可靠的现象。**最终质检证据全部落盘为文件再读取**（/tmp/final-*.txt，exit 码 + 字节数双确认），文件内容用 python 逐行 repr 复核过，不受显示层干扰。

## 修复清单（按文件 × 规则）

### chat.tsx（上一代理修完，本代理复核确认 0 error；git diff 153 行）
| 规则 | 处数 | 修法 |
|---|---|---|
| set-state-in-effect | 6 | 会话级 state 的 `[sessionKey]`/`[wbContactId]` 同步重读 effect 删除 → lazy useState 初始化（ChatView 按 storageKey keyed 重挂载，切会话天然重读；覆盖 replyCountValue/transCfg/sentenceSend/timeAware/wbBound/pendingDispatch） |
| set-state-in-effect | 1 | `delivering`（useState+同步 effect 订阅）→ `useSyncExternalStore(subscribeAiDeliveryActive, snapshot, false)`（投递状态本属模块级外部系统） |
| set-state-in-effect / globals | 2 | ChatApp 跨 App 跳转消费：effect 内 setState+模块变量写入 → 收敛到外部系统回调（loadContacts 的 .then/.catch 内写 state 并消费在途请求；灵动岛事件回调联系人就绪时现场消费）；**nonce 次数哨兵**防重入（每次请求 +1 恰好消费一次，等价原「置空防重入」）；相关 ref 全部只在事件/回调里读写 |
| set-state-in-effect | 1 | 好友会话预览 effect → render 期 `useMemo(() => scanContactSessions(contacts), [contacts, view, reloadKey])` 派生（触发时机与原 effect 依赖集一致） |
| refs | ~3 | onMsgsChangeRef / consumeJumpRef / showToastRef 等镜像 ref 的赋值从 render 期移入 effect |
| preserve-manual-memoization | 2 | commitVoiceMsg / sendTextAsVoice 依赖数组含 showToast（其体内改写 toastTimer ref = 可变依赖，破坏手工 memoization 保留）→ 经 `showToastRef.current(...)` 调最新实现，依赖数组移除 showToast |
| immutability | 1 | loadContacts 由 async 函数体内同步 setState → 改 .then/.catch 回调写（loading 中间态由初始值承担） |

### qq-group.tsx（上一代理修完，本代理复核确认 0 error；git diff 75 行）
| 规则 | 处数 | 修法 |
|---|---|---|
| set-state-in-effect | 1 | 群号缺省补发 effect → lazy `useState(() => group.no ?? ensureGroupNo(gid))`（页面按 gid keyed 重挂载；ensureGroupNo 生成即落盘幂等，StrictMode 双初始化读到同号） |
| set-state-in-effect | 1 | 流收尾 `setMsgs(loadGroupMsgs(gid))` + `clearChatStream(sKey)` 并入同一 setTimeout(0) 回调（仅延后一个宏任务，先后顺序不变） |
| refs（render 写） | 4 | onToastRef / contactsRef+groupRef / runGroupTurnRef / sendTextAsVoiceRef 赋值移入 effect（读取方均为事件回调/定时器，晚于 effect） |
| refs（render 读） | 1 | members useMemo 读 `groupRef.current.memberIds` → 直接 `group.memberIds`（依赖数组本就含） |
| refs（render 读） | 4 | runningRef render 期读（canDispatch + 发送按钮 disabled/className/style ×4 处）→ 同点置位的 `running` state 镜像（runGroupTurn 起止 `setRunning(true/false)` 与 ref 写同一回调内批处理） |
| immutability | 1 | runGroupTurn 内 400ms 延迟补跑自引用声明中的 const → `runGroupTurnRef.current(trigger)` 分发 |
| immutability | 1 | `setMenuRect` useState 声明上移至 `useBubbleLongPress` 之前（闭包前向引用；初始化器为纯函数引用，hook 顺序稳定，无行为影响） |

### wx-group.tsx（上一代理修 7 类 + 本代理收尾 4 处；git diff 52 行）
上一代理已就位：contactsRef+groupRef / runGroupTurnRef / sendTextAsVoiceRef 三组 render 写 ref → effect；members 直读 group.memberIds；流收尾 setMsgs 并入 setTimeout(0)；running 镜像 state 声明与 runGroupTurn 内 setRunning(true/false) 同点置位；runGroupTurn 自引用改 ref 分发。
**本代理修复：**
| # | 规则/性质 | 位置 | 修法 |
|---|---|---|---|
| 1 | 上一代理遗留重复声明（tsc TS2451 ×6） | 原 L2534-2538 | **纯删除**重复的 `running`/`runGroupTurnRef` 声明块（与首份逐字节相同，零行为变更） |
| 2 | react-hooks/immutability | L4538（现） | `setMenuRect` useState 声明上移至 `useBubbleLongPress` 前（与 qq-group 同款修法+同款注释） |
| 3 | react-hooks/refs | L4985（现） | canDispatch 读 `runningRef.current` → `running` state（qq 同款：值一致，置位同点） |
| 4 | react-hooks/refs | L5679（现） | 发送按钮 `disabled={streaming \|\| runningRef.current}` → `running`（另 6 条 5672 处 refs 报错是 canDispatch 派生的下游，#3 修完自动清零） |

## 按规则分类统计（三文件合计 85 errors → 0）

- **set-state-in-effect**（12）：lazy useState 初始化 ×7（keyed 重挂载/幂等落盘语义）· useSyncExternalStore ×1 · 外部系统回调（.then/.catch / 事件回调）×2 · render 期 useMemo 派生 ×1 · 合并入已有 setTimeout(0) ×1
- **refs / refs-during-render**（~21）：render 写 ref → effect ×10 · render 读 ref → state 镜像 ×5（qq/wx running、按钮态）· render 读 ref → 直读源值 ×2（members；依赖已含）· 读最新实现经 ref 分发 ×4
- **preserve-manual-memoization**（2）：可变依赖（函数体内改 ref 的 showToast）经 ref 镜像读，依赖数组移除该函数
- **immutability**（4）：声明上移 ×2 · useCallback 自引用改 ref 分发 ×2

## 动了逻辑形状的修复点（语义风险披露）

1. **chat.tsx ChatApp 跨 App 跳转消费重构**（改动最大）：原「pendingJump effect 监听三依赖」→「loadContacts 回调消费 + 灵动岛回调现场消费 + nonce 幂等」。风险点：载入失败路径原版在 error 态也清 pendingJump，新实现 `.catch` 里同样消费（传最后已知快照），语义对齐；同联系人重复跳转靠 nonce 递增重新消费。已在代码注释中完整推演。
2. **contactSessions 改 useMemo**：非 main 视图期间 contacts/reloadKey 变化也会重算（原 effect 有 `view!=='main'` 早退），但非 main 视图不渲染该列表，值语义等价；代价是多算一次纯函数（scanContactSessions），无副作用。
3. **delivering → useSyncExternalStore**：快照函数每次返回 `isAiDelivering(sessionKey)` 真值，getServerSnapshot=false；订阅粒度由 ai-delivery 模块 emitActive 全量通知承担，语义与原「初始读一次+订阅」一致。
4. **running state 镜像（qq/wx）**：render 读 ref 改读 state，ref 仍保留（事件回调内同步判重入仍用 ref，行为不变）；state 触发的重渲染比 ref 即时读晚一拍（批处理内同点置位，实际不可感知），发送按钮/canDispatch 判定值一致。
5. **流收尾 setMsgs 延后一个宏任务**（qq/wx）：与 clearChatStream 合并进同一 setTimeout(0)，落库消息快照反而更新鲜；清流时机、先后顺序不变。
6. **groupNo lazy 初始化**（qq）：依赖「页面按 gid keyed 重挂载」这一既有结构；挂载后宿主刷新带来的 `group.no` 与惰性生成值一致（ensureGroupNo 落盘幂等），无漂移。
7. **wx 重复声明删除**：两份逐字节相同，删除其一为纯等价操作。

## 禁碰文件确认

未触碰 src/lib/ios/shizuku-agent.ts、shizuku-autonomy.ts、native-perception.ts、settings.tsx、PhoneShell.tsx（工作树中前两者的修改来自并行任务 4-a，见其记录 4-a-agent-core.md）。

## 质检原文（最终态，输出落盘后读取）

```
=== ESLINT（逐文件，NODE_OPTIONS=--max-old-space-size=6144） ===
$ npx eslint src/components/apps/chat.tsx     > /tmp/final-chat.txt     ; echo $?
chat.tsx eslint exit=0 output-bytes=0
$ npx eslint src/components/apps/qq-group.tsx > /tmp/final-qq-group.txt ; echo $?
qq-group.tsx eslint exit=0 output-bytes=0
$ npx eslint src/components/apps/wx-group.tsx > /tmp/final-wx-group.txt ; echo $?
wx-group.tsx eslint exit=0 output-bytes=0

=== TSC GATE ===
$ bunx tsc --noEmit 2>&1 | grep -E "chat\.tsx|qq-group|wx-group"
(无任何输出)
tsc-grep exit=1 (1=zero-output)
（全量 tsc 仅剩范围外文件的存量错误：couple-space.tsx LOVE_HEART_PATH×33+--rot、
 registry.tsx setTimeout-on-never、src/lib/perception.ts ×2 —— 均不在本任务三文件内，未触碰）

=== DEV SERVER（:3000 后台，日志 /home/z/my-project/dev.log） ===
touch 三文件强制重编译 → ✓ Compiled in 985ms；GET / 200（多次，application-code 19~46ms）
curl http://localhost:3000/ → 200；dev.log 无编译错误、无新增 error 行

=== 行为冒烟（agent-browser @ http://localhost:3000） ===
1) agent-browser eval "$(cat tmp-analysis/e2e45/unlock.js)" → "unlocked=true"（锁屏上滑解锁）
2) 点击「打开信息」→ 信息主界面正常：顶栏（返回主屏幕/切换匿名号码/添加好友）+ 会话列表
   （小助手·预览文本·未读角标）+ 信息/联系人分组 tab
3) 进入小助手会话 → ChatView 正常挂载：头部（返回/10086/聊天设置）+ 消息 log（欢迎语+iMessage 时间戳）
   + 输入区（更多功能/消息输入框/转语音/语音输入）
4) console 无 error/warn
5) 返回 → 回主屏幕成功（信息 dialog 关闭，桌面图标可见）
```

## 遗留与移交说明

1. 本任务未新增任何 eslint-disable、未删任何 useMemo/useCallback、未引入 setTimeout 骗 lint（已有的两处 setTimeout(0) 合并属既有 setTimeout 收尾路径的等价合并，非新增包装）。
2. 范围外文件的 tsc 存量错误（couple-space/registry/perception）建议另立任务处理。
3. Bash 通道 `[m` 吞字现象复现于 git diff / rg 输出（Read 工具不受影响）——后续代理审阅大文件 diff 时建议落盘为文件再读，或对含 `[m` 的行做掩码复核，勿凭显示层直接改码。
