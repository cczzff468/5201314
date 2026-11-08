# Task 4-d 工作记录：C2 推送到手机通知栏（客户端本地通知统一入口 + 原生 localNotify + 三事件源接线）

执行代理：4-d-push-notify
日期：2026-11-08（基线 HEAD afa6437 v84；工作树另含 4-a/4-b 等并行任务未提交改动，未触碰）
状态：✅ 完成（我改的 ts 文件 tsc 零输出 / eslint 六文件 exit 0 零 error，CoupleHome.tsx 仅存 HEAD 同款 52 个既有 error、我的新增行零贡献 / dev.log 编译通过 / API 三连冒烟通过 / agent-browser 解锁无 JS 异常）

## 一、改动清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/lib/ios/local-notify.ts` | **新建**（140 行） | 客户端本地通知统一入口：`notifyIfHidden(title, body, opts?: {tag?, url?, icon?})` 与 `cancelLocalNotify(tag)`。前台（`document.hidden === false`）静默跳过；原生壳内（`isNativePerception`）直发 `NativePerception.localNotify`；纯浏览器/PWA 在权限 granted 时走 `ensureSwRegistration()`（复用 system-notify 幂等注册）→ `showNotification`（tag 去重、icon 可选、`data.url` 供 sw.js notificationclick 聚焦/新开），SW 不可用回落 `new Notification`（Android 页内无构造器 → 静默）。全程 try-catch 静默 |
| 同上（实现关键点） | 「发后即忘」桥调用 | `nativeFireAndForget()` 只向 `window.androidBridge.postMessage` 投递 Capacitor 协议报文 `{callbackId, pluginId:'NativePerception', methodName, options}`（`ln-` 前缀 callbackId），**不注册任何回包钩子** —— native-perception.ts 的 `ensureBridgeHook` 独占 `onmessage`/`fromNative` 路由，未知 callbackId 被其静默忽略，因此零干扰、也不会把既有原生调用路由搞挂（本文件无权改 native-perception.ts，这是唯一安全接法） |
| `android-shell/.../NativePerceptionPlugin.java` | +107 行（唯一 Android 改动） | 新增 `localNotify({title, body, tag?})` 与 `localNotifyCancel({tag})` 两个 @PluginMethod（插在 agentNotifyEnd 之后）：渠道 `local_notify`（IMPORTANCE_DEFAULT，独立于 agent_runner 可单独静音）；带 tag 时 `id = tag.hashCode()` 组成稳定 (tag,id) 对 → 同 tag 后发替换先发（去重）、cancel 按同对撤销，无 tag 用自增 id（起点 8100，避开 Agent 常驻 7788）；`setAutoCancel(true)` + 非 ongoing（可滑除、非常驻）、无「紧急停止」action；contentIntent 打开 MainActivity（singleTask 带回前台，FLAG_IMMUTABLE）；小图标 `android.R.drawable.ic_dialog_info`（与 agentNotify 同源） |
| `android-shell/.../AndroidManifest.xml` | **零改动** | `POST_NOTIFICATIONS` 已在清单中（`<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`），按任务书「已含则不重复」跳过；Android 13+ 权限处理：localNotify 内先 `ContextCompat.checkSelfPermission`（SDK≥33）+ `nm.areNotificationsEnabled()` 双检查，未授予/关闭静默 `{ok:false, reason:'no-notification-permission'/'notifications-disabled'}`，兜底 Throwable catch 不 crash |
| `src/lib/ios/shizuku-agent.ts` | +4 行（仅收尾通知点） | ① import `notifyIfHidden`；② `runAgentTask` 的 `finally` 末尾（patchAgentState 之后）加：`void notifyIfHidden('智能体', (result.text || 'Agent 任务已结束').split('\n')[0].slice(0,120), { tag:'agent', url:'/' })` —— done/fail/stopped/异常全部终态统一在此收口，取结果摘要首行。**其余逻辑零改动**（注：`git diff` 里该文件共 +483 行是并行任务 4-a 的未提交改动，我的增量只有这 4 行） |
| `src/lib/ios/proactive-call.ts` | +15 行（3 个通知点） | ① `tickInner`（主动来电拨打处）：`triggerIncomingCall` 之前 `notifyIfHidden('来电', '{name} 打来一通视频/语音电话', {tag:'ai-call-'+id})`；② `triggerBlockCall`（拉黑事件直拨）：同上（文案「打来电话」）；③ `recordMissedPhoneCall`：留言确实 `localDB.put('voicemails')` 落库后（`texts.length>0` 才发，防「说有留言其实没有」）→ `cancelLocalNotify('ai-call-'+id)` 撤掉「来电中」通知 + `notifyIfHidden(displayName, '未接来电 · 给你留了语音留言…', {tag:'ai-vm-'+id})` |
| `src/components/apps/couple-home/CoupleHome.tsx` | +6/-1 行（最小侵入） | 复用既有「G8 进门未读便签提醒」effect（首个带便签档案到达只弹一次，天然防刷屏）：`if (unread > 0)` 分支内 toast 旁追加 `notifyIfHidden('情侣小家', 'TA给你留了 N 条便签…', {tag:'couple-home-notes', url:'/'})` |
| `src/lib/server/push-send.ts` | +12/-2 行 | `PushEnvelope` 增可选 `excludeTag?: string`；`pushToAllSubscribers` 循环内按订阅记录 `tag` 字段过滤：`subTag === excludeTag` → 跳过发送但**保留在 alive 表**（跳过≠失效）。向后兼容：无 tag 旧订阅永不被排除、excludeTag 缺省行为与历史完全一致 |
| `src/lib/ios/push-client.ts` | +27/-2 行（仅 deviceTag 上报） | 新增 `deviceTag()`：localStorage `ios-push-device-tag` 生成一次终身不变（randomUUID，存储不可用返回 ''）；`setupPushSubscription` 上报订阅时 body 带可选 `tag`。teardown / 状态诊断等其余逻辑零改动 |
| `src/app/api/push/route.ts` | +7/-2 行（仅 tag 字段） | POST 接受可选 `tag`（非空字符串、钳 64 字符、trim），存进订阅记录 `next.push({...subscription, ...(tag?{tag}:{})})`；非法/缺失不带 tag。GET/DELETE/鉴权零改动 |
| `src/lib/server/push-store.ts` | **零改动** | 订阅记录用 `SubRec` 的索引签名直接携带 tag，无需动存储层 |
| `public/sw.js` | **零改动** | 既有 push/notificationclick 处理器已满足需求（`data.url` 落地页路径早已支持） |

未碰清单核对：settings.tsx / PhoneShell.tsx / agent-ui.tsx / agent-voice 相关 / chat.tsx / qq-group.tsx / wx-group.tsx / app-version.ts / build.gradle —— 均未改动（`git status` 中 chat.tsx、qq-group.tsx、wx-group.tsx、shizuku-autonomy.ts、agent-voice.ts 的改动来自并行任务，非本任务所写）。未 commit、未 push、未跑 gradle。

## 二、事件源接线说明（各自接线点与通道选择）

| 事件源 | 接线点（改后行号） | 通道 | 触发时机 |
|---|---|---|---|
| a. Agent 任务完成 | `shizuku-agent.ts` runAgentTask `finally` 末尾（L1583-1585）；import L62 | 三通道自适应：APK 壳内 → 原生 `localNotify`（通知栏即达，APK 在后台也弹）；浏览器/PWA → SW showNotification；前台一律静默 | done/fail/stopped/异常四类终态统一收口（finally 在所有 return 之后必达），文案取 `result.text` 首行（完成播报 / 失败原因 / 已被用户停止） |
| b. AI 主动消息/来电 | `proactive-call.ts`：`tickInner` L784-789（拨打前）、`triggerBlockCall` L841-842（直拨前）、`recordMissedPhoneCall` L523-528（留言落库后） | 同上；来电用 tag `ai-call-{cid}`（未接时定向撤销）、留言用 tag `ai-vm-{cid}`（与来电通知不互相替换，微信式逐条） | 读文件结论：该文件的「消息落地点」是未接 AI 语音留言（voicemails 落库），「来电落地点」是两处 `triggerIncomingCall` —— 三处都接；未接留言通知特意放在留言**确实落库后**且 `texts.length>0`，避免空留言谎报 |
| c. 情侣空间动态 | `CoupleHome.tsx` G8 未读便签 effect L3297-3308 | 同上；固定 tag `couple-home-notes`（同挂载周期只提醒一次，effect 自带 notesRemindRef 防重） | 详见下节：服务端方案被架构结论否决，选客户端方案 |

补充：`localNotify`（原生）与 SW push 通道互不重复 —— 原生通道由页面 JS 直发（APK 内），SW push 由服务端 web-push 下发（/api/chat/bg 离线接力等既有路径），两者载荷/触发场景不同，无叠加。

## 三、couple-home 架构结论与方案取舍

**架构事实（读 route + catalog + CoupleHome 后的结论）：**
1. `/api/couple-home` 是**按 `X-Workspace-Id`（每浏览器 localStorage 各自生成的 UUID，见 `src/lib/ios/workspace.ts`）隔离的单行快照存储**：GET 拉快照、POST 全量覆盖 + rev 乐观并发（rev 不一致 409 回带服务端最新）。
2. 客户端同步三路径：挂载 `fetchRemote`（远端 rev 更新则 adoptHome 采纳）→ 本地改动 2.5s 防抖 `pushRemote` → ~30s 周期 pushRemote；409 冲突时采纳服务端 + toast「已同步对方的最新布置」。
3. **关键推论：不存在「两台设备共享同一个家」的服务端通道。** workspaceId 每浏览器独立 ⇒ 不同设备永远各自一行；该 API 唯一真实的「双端」是同浏览器多标签页（共享 localStorage）。服务端快照里的 `by:'me'|'partner'` 是**同一台设备上的视角字段**（全代码检索确认：`by:'partner'` 无任何写入点，是远端同步/预留位），不能用于区分「哪个设备产生了动作」。「喂宠物/考试/做饭」等动态都是本机用户 + 本机 AI 伴侣系统本地产生后写进同一快照。

**方案取舍：**
- ❌ **服务端 `pushToAllSubscribers` 方案否决**：① 服务端无任何身份字段可区分动作发起者（POST 只有 data+rev）；② 更根本的——没有「对方设备」在这个数据流里（对方设备的 workspaceId 不同，根本读不到这个家的行），广播出去要么无人接收、要么通知到发起者自己的其他设备（体验是「我自己写了张便签，我的桌面预览也弹通知」），纯噪音。为此补 deviceTag/excludeTag 也救不了「没有订阅对方设备」的本质问题。
- ✅ **选客户端 `notifyIfHidden` 方案（最小侵入）**：客户端「发现对方动态」的既有判定点就是 G8 未读便签 effect（`by==='partner' && ts>seen.me`，自带防重），toast 在页面后台看不见 ⇒ 正是该补系统通知的时机。一行级接入，零重构。
- 🔧 **deviceTag/excludeTag 基建仍按任务书 #4 落地**（push-client 上报 / api/push 存 tag / push-send 过滤）：当前无调用方（chat/bg 接力回复的订阅者就是发起者本人，不应排除），但作为向后兼容的预留能力，未来任何「服务端可区分设备」的对方可见动态路径可直接复用。

## 四、质检原文

```
=== TSC GATE（任务书口径） ===
$ bunx tsc --noEmit 2>&1 | grep -E "local-notify|push-|proactive|couple|shizuku-agent|CoupleHome|couple-home|api/push"
(无任何输出) grep_exit=1（1=零输出）

$ bunx tsc --noEmit 2>&1 | rg "^src" | sed 's/(.*//' | sort | uniq -c     # 全量错误分布（共 42 条）
     33 src/components/apps/couple-space.tsx
      1 src/components/apps/registry.tsx
      2 src/components/ios/AssistiveTools.tsx
      1 src/components/ios/ChatFloatWindow.tsx
      1 src/lib/ios/couple-ai.ts
      2 src/lib/ios/prompt-preview.ts
      2 src/lib/perception.ts
→ 全部 7 个文件 `git diff HEAD -- <file>` 均为 0 行（未入工作树改动，HEAD 既有基线错误，
  含 grep 到的 couple-space.tsx / couple-ai.ts；非本任务所改，且不在本任务可改清单内）
我的 9 个目标文件（local-notify/push-send/push-client/api/push/proactive-call/
shizuku-agent/CoupleHome/couple-home route）tsc 全零。

=== ESLINT GATE ===
$ NODE_OPTIONS=--max-old-space-size=6144 npx eslint src/lib/ios/local-notify.ts \
    src/lib/ios/shizuku-agent.ts src/lib/ios/proactive-call.ts src/lib/ios/push-client.ts \
    src/lib/server/push-send.ts src/app/api/push/route.ts
(无任何输出) exit=0 ✅ 零 error

CoupleHome.tsx：52 problems（全部 react-hooks/set-state-in-effect 与 refs-during-render，
行号 388~4719，无一在我改动行 90-92/3303-3307）。基线对照：把 HEAD 版本换入后 eslint 输出
「✖ 52 problems (52 errors, 0 warnings)」完全一致 ⇒ 我的 +6/-1 行零新增。跑完已还原我的版本
（git diff --stat 复核 = 7 行变更）。

=== DEV LOG ===
✓ Compiled in 2.4s / ✓ Compiled in 998ms / ✓ Compiled in 777ms / ✓ Compiled in 888ms / ✓ Compiled in 810ms
GET / 200（多次）、GET/POST/DELETE /api/push 全 200；rg "error|Error|Failed" dev.log
仅命中历史行（876/906/937/967 visionAsk 报错与 1033 useSyncExternalStore 均为 4-a 会话期
旧日志，其后全是 ✓ Compiled，无新增编译错误）。

=== API 冒烟 ===
$ curl -s http://localhost:3000/api/push | head -c 200
{"publicKey":"BDCrQV4Fkj4He3R0OmFq8xF1I0ZdXRASrKUNMBKOPQV7wHrgsvZ8DYfWuG7qyUubCHt3H3RCMhQoRuq11JWa_6E"}
POST（带 tag:'smoke-device-4d' 的合法订阅）→ {"ok":true}；.data/push-subs.json 落盘内容
确认携带 "tag":"smoke-device-4d" 字段；DELETE 同 endpoint → {"ok":true}，subs 回到 []（冒烟数据已清理）。

=== agent-browser 冒烟 ===
$ agent-browser open http://localhost:3000 && agent-browser errors
(空 —— 首屏加载零 JS 异常)
复用 tmp-analysis/e2e45/unlock.js 合成 PointerEvent 上滑：
$ agent-browser eval "$(cat tmp-analysis/e2e45/unlock.js)" → "unlocked=true"
解锁后多次交互（snapshot/拖拽尝试）再查 agent-browser errors：(空) —— 无新报错。
本地通知在浏览器前台不触发为预期行为（document.hidden 闸门）；APK 通道与 13+ 权限检查
在原生侧，需主控重打 APK 后真机验证（未跑 gradle，遵守约束）。
```

## 五、偏离说明

1. **AndroidManifest.xml 未改动**：POST_NOTIFICATIONS 已在清单声明（agentNotify 时代已补），按任务书「已含则不重复」处理；原生侧以「SDK≥33 checkSelfPermission + areNotificationsEnabled 双检查」实现「无权限静默 ok:false」。
2. **`local-notify.ts` 直发原生桥的方式是「发后即忘」而非等待回包**：native-perception.ts 不在本任务可改清单内，且其 `ensureBridgeHook` 独占 window 级回包路由（先装者赢，后装者会被跳过导致既有原生调用全部挂死）；因此本模块只投递协议报文、不注册钩子，localNotify 的 `{ok,reason}` 回包由既有路由按「未知 callbackId」静默忽略。代价是 JS 侧拿不到原生失败原因——任务书本就要求「全程静默、绝不影响业务」，等价满足。
3. **couple-home 只接了「留言板未读便签」一个通知点**：喂宠物/考试/做饭等动态经排查均为本机动作（无跨设备对方），接了只会「自己通知自己」；服务端推送路线被架构结论否决（详见第三节）。
4. **proactive-call 的「AI 主动消息」落点选择了该文件实际存在的三处**（两次来电发起 + 未接语音留言落库）；AI 主动消息本体（聊天消息）在 proactive-msg.ts 且已由 island-notify 的 pushChatNotification 覆盖后台系统通知，未重复接线。
5. **质检 grep 口径**：任务书给的 grep 模式会命中 couple-space.tsx / couple-ai.ts 的 HEAD 既有错误（33+1 条）；已用 `git diff HEAD` 逐文件证明 0 行改动（非本任务引入），我改的文件在该口径下全部零输出。
