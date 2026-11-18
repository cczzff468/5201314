# Task 3-a：Mobile Agent Android 原生层（v1.5）

## 完成状态：✅ 全部完成，gradle 编译 BUILD SUCCESSFUL

## 改动/新增文件

| 文件 | 类型 | 职责 |
|---|---|---|
| `android-shell/android/app/src/main/java/com/z/aiphone/AdbImeService.java` | 新增 | 无 UI 的中文输入引擎 IME：onCreate 注册 `com.z.aiphone.AGENT_IME_INPUT` 广播 receiver（extra `text`，兼容 `msg`），收到后 `getCurrentInputConnection().commitText(text, 1)` 注入中文/emoji；onCreateInputView 返回 1x1 占位视图 |
| `android-shell/android/app/src/main/res/xml/method.xml` | 新增 | IME 声明（subtype zh_CN「AI 输入」，supportsSwitchingToNextInputMethod） |
| `android-shell/android/app/src/main/AndroidManifest.xml` | 修改 | MediaListenerService 后新增 AdbImeService 声明（BIND_INPUT_METHOD + android.view.InputMethod intent-filter + @xml/method） |
| `android-shell/android/app/src/main/java/com/z/aiphone/NativePerceptionPlugin.java` | 修改 | ① 白名单加 `uiautomator`/`ime`；② shizukuExec 内核抽出为 `runWhitelistedShell()`（对外行为不变）；③ 新增 9 个 @PluginMethod + load()/handleOnDestroy() 生命周期；④ 头部注释加「⑥ Mobile Agent（v1.5）」 |
| `android-shell/android/app/build.gradle` | 修改 | versionCode 8→9，versionName 1.4.3→1.5.0 |

## 9 个新方法签名（最终实现，与契约一致）

1. `executeShell({cmd: string[], timeoutMs?=15000})` → `{ok:true,out}` / `{ok:false,reason}`（cmd 非法/不在白名单 reject；内核 runWhitelistedShell(call, cmd, null, 4000, timeout)，timeout 硬顶 30000）
2. `getScreenResolution()` → `{ok:true,width,height,raw}` / `{ok:false,reason:'parse'|gate,raw}`；wm size 解析，Override size 优先、Physical size 兜底（正则 `(\d+)x(\d+)`）
3. `dumpUi()` → `{ok:true,xml}` / `{ok:false,reason:'dump-failed',out}`；`uiautomator dump --compressed /sdcard/window_dump.xml`（输出不含 "dumped" 则 sleep 900ms 重试一次）→ `cat` 取全文（maxLines 400，为空 sleep 300ms 重试一次）
4. `inputChinese({text})` → 纯 ASCII：`input text`（空格转 %s）→ `{ok:true,via:'ascii',switched:false,currentIme:''}`；含非 ASCII：settings get secure default_input_method → 不等于 `com.z.aiphone/.AdbImeService` 则 ime enable + ime set（sleep 800ms 等 IME 绑定）→ am broadcast AGENT_IME_INPUT → `{ok:true,via:'ime',switched,currentIme}`；**不恢复原输入法**（前端调 restoreIme）
5. `restoreIme({imeId})` → imeId 空 `{ok:false,reason:'no-ime'}`，否则 `ime set` → `{ok:true}`
6. `agentShouldStop()` → `{stop: boolean}`（static volatile AGENT_ABORT）
7. `agentResetStop()` → AGENT_ABORT=false → `{ok:true}`
8. `agentNotify({title, text?})` → 渠道 agent_runner（API 26+ 版本闸）+ NotificationCompat（小图标 android.R.drawable.ic_dialog_info，项目 res/drawable 无通知图标资源）+ addAction「■ 紧急停止」（PendingIntent.getBroadcast FLAG_IMMUTABLE，setPackage）→ cancel(7788)+notify(7788)；SecurityException → `{ok:false,reason:'no-notification-permission'}`
9. `agentNotifyEnd()` → cancel(7788) → `{ok:true}`

紧急停止 receiver：`load()` 里 `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)`（Capacitor 8 无 pluginInitialize()，load() 是标准初始化点；PendingIntent 本应用自发自收，NOT_EXPORTED 可达），handleOnDestroy 注销。

## AdbImeService 生命周期决策

选 **onCreate/onDestroy**（非 onCreateInputView/onDestroyInputView）：InputMethodService 的输入视图按需创建，无 UI IME 可能整个生命周期都不触发 onCreateInputView；且这对回调跟随输入视图显隐而非服务本体。receiver 必须服务全程可用 → 挂服务本体生命周期。

**关键实现细节**：IME 的注入广播由 shell uid 2000 经 `am broadcast` 发出（ShizukuUserService），既非本应用也非系统 uid —— Android 14+ targetSdk 34+ 的 NOT_EXPORTED 动态 receiver 会拒收（ADBKeyboard 在 Android 14 失灵的根因），故 IME receiver 必须 **RECEIVER_EXPORTED**（已在类注释说明风险：私有 action + IME 仅 Agent 任务期短暂启用）。

## 偏离契约的决策

1. **inputChinese 切换后 sleep(800ms) 再广播**：ime set 是异步绑定，紧随广播会因 InputConnection 未就绪丢首个输入（契约未提及，已注释说明）
2. **cat 为空重试前 sleep(300ms)**：契约只说重试一次，加了短暂等待更稳
3. **IME receiver 用 RECEIVER_EXPORTED**（契约未指定导出性；理由见上，必须如此才能收到 shell 广播）
4. **capacitor 8 无 pluginInitialize()**（实测源码确认，v3 时代已移除）→ 用 `load()` hook，符合契约「若无则换」的指示
5. agentNotify 用 `NotificationCompat.Action.Builder(0,...)` 非 deprecated 的 addAction(int,...)
6. getScreenResolution 失败时额外带 raw 字段便于前端排查

## 编译结果

- `JAVA_HOME=/home/z/jdk ANDROID_HOME=/home/z/android-sdk ./gradlew assembleDebug --no-daemon` → **BUILD SUCCESSFUL**（首次全量通过，增量 17s；仅一条与本次无关的 deprecation Note）
- 产物：`app/build/outputs/apk/debug/app-debug.apk`（4.18MB）
- 未运行 build-apk.sh（未部署 APK 到 public/），未改 AIDL / UserServiceArgs.version(3)

## 前端对接提示

- NativePerception.executeShell / getScreenResolution / dumpUi / inputChinese / restoreIme / agentShouldStop / agentResetStop / agentNotify / agentNotifyEnd 均可直接调用
- Agent 任务开始：agentResetStop → agentNotify；每步动作前轮询 agentShouldStop；结束：agentNotifyEnd + restoreIme(currentIme)
- inputChinese 返回的 currentIme 为切换前的原输入法 id（首次切换时），存下来用于 restoreIme
