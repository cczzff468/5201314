package com.z.aiphone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.inputmethodservice.InputMethodService;
import android.view.View;
import android.view.inputmethod.InputConnection;

import androidx.core.content.ContextCompat;

/**
 * Agent 中文输入引擎（v1.5 Mobile Agent）：
 *
 * 无 UI 的输入法服务 —— 永不展示键盘，只作为「文本注入通道」：Agent 任务执行期间由
 * NativePerceptionPlugin.inputChinese 经 Shizuku 执行 ime enable/set 切换到本输入法，
 * 再广播 ACTION_AGENT_IME_INPUT（extra key "text"，兼容 ADBKeyboard 惯例的 "msg"），
 * 服务收到后经 InputConnection.commitText 原生提交 —— 中文/emoji 均可注入
 * （这是 `input text` 命令做不到的，后者只支持 ASCII 与 %s 转义）。
 *
 * 参照 ADBKeyboard（senzhk/ADBKeyBoard）开源项目的广播注入原理重写，两点关键差异：
 *
 * 1) receiver 注册在 onCreate / 注销在 onDestroy（而非 onCreateInputView /
 *    onDestroyInputView）：InputMethodService 的输入视图是「按需创建」的 ——
 *    系统首次需要展示键盘 UI 时才回调 onCreateInputView，本 IME 永不显示 UI，
 *    该回调可能整个生命周期都不会触发；且这对回调跟随输入视图的创建/销毁
 *    而非服务本体。receiver 必须在服务存续期间始终可用，挂在服务本体生命周期
 *    （onCreate/onDestroy）上才可靠。
 *
 * 2) 必须用 RECEIVER_EXPORTED（而非 NOT_EXPORTED）：注入广播由 shell 侧发出
 *    （inputChinese 经 Shizuku 执行 `am broadcast`，sender uid 2000 = com.android.shell，
 *    既非本应用也非系统 uid 1000），Android 14+（targetSdk 34+）的 NOT_EXPORTED
 *    动态 receiver 会拒收外部 uid 广播 —— 这正是 ADBKeyboard 在 Android 14 上
 *    集体失灵的根因。风险可控：action 为本应用私有字符串、本 IME 仅在 Agent
 *    任务执行期间被切换启用（任务结束即恢复原输入法），暴露面与 ADBKeyboard 相当。
 */
public class AdbImeService extends InputMethodService {

    /** Agent 文本注入广播（NativePerceptionPlugin.inputChinese 经 shell am broadcast 发出） */
    public static final String ACTION_AGENT_IME_INPUT = "com.z.aiphone.AGENT_IME_INPUT";

    private BroadcastReceiver inputReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        // 生命周期选择理由见类注释 1)：服务本体生命周期，而非输入视图的按需创建/销毁
        inputReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !ACTION_AGENT_IME_INPUT.equals(intent.getAction())) return;
                String text = intent.getStringExtra("text");
                if (text == null || text.isEmpty()) {
                    text = intent.getStringExtra("msg"); // 兼容 ADBKeyboard 惯例 extra key
                }
                if (text == null || text.isEmpty()) return; // 空文本直接忽略
                InputConnection ic = getCurrentInputConnection();
                if (ic != null) {
                    ic.commitText(text, 1); // 中文/emoji 原生支持
                }
            }
        };
        // RECEIVER_EXPORTED 的原因见类注释 2)（sender 是 shell uid，NOT_EXPORTED 拒收）
        ContextCompat.registerReceiver(this, inputReceiver,
                new IntentFilter(ACTION_AGENT_IME_INPUT), ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    public void onDestroy() {
        if (inputReceiver != null) {
            try {
                unregisterReceiver(inputReceiver);
            } catch (Throwable ignored) {
            }
            inputReceiver = null;
        }
        super.onDestroy();
    }

    @Override
    public View onCreateInputView() {
        // 本 IME 永不显示键盘 UI：返回 1x1 占位视图，纯文本注入通道
        View v = new View(this);
        v.setMinimumWidth(1);
        v.setMinimumHeight(1);
        return v;
    }
}
