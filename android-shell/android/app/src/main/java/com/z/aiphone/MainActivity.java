package com.z.aiphone;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生感知插件注册（必须先于 super.onCreate）
        registerPlugin(NativePerceptionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
