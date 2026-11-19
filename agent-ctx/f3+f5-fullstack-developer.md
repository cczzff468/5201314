# f3+f5 — full-stack-developer 工作记录

## 任务概览
- 任务一：三端聊天页（信息端 chat.tsx / 微信 wx-app/chat-page.tsx / QQ qq-app/chat-page.tsx）渲染 tool_status 气泡 + 消息类型 + AI 上下文排除
- 任务二：新增 5 个工具（toolOpenChat / toolGetCalendarEvents / toolAddCalendarEvent / toolGetTodoList / toolAddTodo）

## 改动文件清单

### 任务一（tool_status 气泡渲染）

1. **src/lib/ios/tool-status-bubble.ts**
   - `ToolStatusMsg.role` 类型放宽到 `'assistant' | 'peer'`
   - `pushToolStatusBubble` 按会话 sessionKey 前缀决定 role：wx:/qq: → 'peer'，其余（含 sms: / assistant / 默认）→ 'assistant'，确保三端 loadMsgs 的 role 白名单过滤都能通过

2. **src/components/apps/chat.tsx**（信息端）
   - `ChatMsg.kind` 联合类型加 `'tool_status'`
   - 加字段 `tool?: { title: string; body?: string; status: 'pending' | 'done' | 'fail'; tool?: string }`
   - import: `import { ToolStatusBubble } from './tool-status-bubble';`
   - 在消息 map 渲染默认文本气泡之前加 `m.kind === 'tool_status' && m.tool ? (<ToolStatusBubble .../>) : (...)` 分支
   - runAiTurn 的 history filter 加 `m.kind !== 'tool_status' &&` 排除
   - 加 useEffect 订阅 `tool-status-msgs` CustomEvent，按会话增量合并 + tool 字段刷新（防 pending→done 内容被旧值覆盖）

3. **src/components/apps/wx-app/core.tsx**（微信消息类型）
   - `WxMsg.kind` 联合类型加 `'tool_status'`
   - 加字段 `tool?: { title; body?; status; tool? }`

4. **src/components/apps/wx-app/chat-page.tsx**（微信聊天页）
   - import: `import { ToolStatusBubble } from '../tool-status-bubble';`
   - 在 lettercard 分支之后、默认文本气泡之前加 tool_status 渲染分支
   - runAiTurn history filter 加 `m.kind !== 'tool_status' &&` 排除
   - 加 useEffect 订阅 `tool-status-msgs`

5. **src/components/apps/qq-app/core.tsx**（QQ 消息类型）
   - `QQMsg.kind` 联合类型加 `'tool_status'`
   - 加字段 `tool?: { title; body?; status; tool? }`

6. **src/components/apps/qq-app/chat-page.tsx**（QQ 聊天页）
   - import: `import { ToolStatusBubble } from '../tool-status-bubble';`
   - 在 lettercard 分支之后、voice 分支之前加 tool_status 渲染分支
   - runAiTurn history filter 加 `m.kind !== 'tool_status' &&` 排除
   - 加 useEffect 订阅 `tool-status-msgs`

### 任务二（5 个新工具）

7. **src/lib/ios/web-tools.ts**
   - 新增 `toolOpenChat(contactName)`：listContacts 模糊匹配 → 决定 App（wx/qq/sms）→ openScreenApp 打开
   - 新增 `toolGetCalendarEvents(date?)`：localDB.getAll('events')，支持今天/明天/后天/绝对日期/重复日程
   - 新增 `toolAddCalendarEvent(title, time)`：写 IndexedDB events 表，复用 parseAlarmTime 解析自然时间
   - 新增 `toolGetTodoList()`：读 IndexedDB notes 表，筛含 checklist 未完成项 + 标题/正文含「待办/TODO/任务」字样
   - 新增 `toolAddTodo(text)`：写 notes 表，标题自动加「待办：」前缀
   - 工具内部 island() 调用 → 推 tool_status 气泡到当前 sessionKey（已有逻辑）
   - 调试口 `__webTools` 注册 5 个新函数

8. **src/lib/ios/phone-tools.ts**
   - import 加 5 个新工具
   - `TOOL_CAPS` 加 5 个条目（openChat / getCalendarEvents / addCalendarEvent / getTodoList / addTodo）
   - `buildPhoneTools` 加 5 个 `add()` 定义（FC schema）
   - `execWebTool` switch 加 5 个 case 分发
   - `tools.slice(0, 36)` → `tools.slice(0, 40)`（22 网页 + 16 真机 = 38，留 2 余量）

9. **src/lib/ios/shizuku-autonomy.ts**
   - `buildAutonomyDirective` 的 `[当前可用工具清单]` 文案末尾追加 5 个新工具的描述（device 模式与 web 模式两份文案都更新）

10. **src/app/api/chat/route.ts**
    - `sanitizeTools` 上限 36 → 40（与新工具总数对齐）

## 验证
- `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/` → **HTTP 200**
- dev.log 多次 `✓ Compiled in ~900ms`，无 TypeScript / 编译错误
- `bun run lint` 因内存被 kill（项目本身规模大），但 dev server 编译持续成功

## 注意事项
- tool_status 消息的 role：信息端用 'assistant'，微信/QQ 端用 'peer'（由 pushToolStatusBubble 按 sessionKey 前缀自动决定）
- tool_status 不进 AI 上下文：三端 runAiTurn 的 history filter 都加了 `m.kind !== 'tool_status'` 显式排除（即使 content 非空也排除）
- tool-status-msgs 事件订阅：收到事件后不仅按 id 增量合并，还把已存在的 tool_status 消息内容刷新（防 pending→done 状态变更时旧值残留）
- NotifyApp 类型不含 'calendar'，日历工具的 island() 用 'chat' 作 fallback app 标签
