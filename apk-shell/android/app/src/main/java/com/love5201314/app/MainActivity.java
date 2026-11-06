package com.love5201314.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import fi.iki.elonen.NanoHTTPD;
import java.io.IOException;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "5201314";
    private GatewayProxy proxy;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 启动本地网关代理（127.0.0.1:8999 → 云网关，自动补 x-session-id）
        SharedPreferences prefs = getSharedPreferences("srv", MODE_PRIVATE);
        proxy = new GatewayProxy(prefs);
        try {
            proxy.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
            Log.i(TAG, "gateway proxy started, upstream=" + proxy.getUpstream());
        } catch (IOException e) {
            Log.e(TAG, "gateway proxy start failed", e);
        }
    }

    @Override
    public void onDestroy() {
        if (proxy != null) {
            proxy.stop();
            proxy = null;
        }
        super.onDestroy();
    }
}
