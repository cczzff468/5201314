package com.love5201314.app;

import android.content.SharedPreferences;
import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * 应用内置本地网关代理：
 *
 * WebView → http://127.0.0.1:8999 →（补 x-session-id 头）→ 云端网关（fcapp.run）
 *
 * 云网关要求每个请求带 x-session-id 头（会话亲和），浏览器/WebView 不会自动带，
 * 所以壳内起一个本地代理统一注入。支持 GET/POST/PUT/DELETE/PATCH、请求体、
 * 流式响应透传（AI 聊天打字机）、Range（音乐/图片）、gzip 透传。
 */
public class GatewayProxy extends NanoHTTPD {

    /** 默认上游（云端网关公网地址） */
    public static final String DEFAULT_UPSTREAM =
            "https://ws-ffbd-d-eacea-kbsjiwxzad.cn-beijing-vpc.fcapp.run";

    private static final int CONNECT_TIMEOUT = 15000;
    private static final int READ_TIMEOUT = 300000; // AI 长回复/流式响应

    private final SharedPreferences prefs;
    private volatile String sessionId;
    private volatile String upstream;

    public GatewayProxy(SharedPreferences prefs) {
        super("127.0.0.1", 8999);
        this.prefs = prefs;
        this.sessionId = prefs.getString("sid", null);
        if (this.sessionId == null) {
            this.sessionId = "apk-" + java.util.UUID.randomUUID().toString();
            prefs.edit().putString("sid", this.sessionId).apply();
        }
        this.upstream = prefs.getString("upstream", DEFAULT_UPSTREAM);
    }

    /** 当前上游地址（诊断用） */
    public String getUpstream() {
        return upstream;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        // ① 配置端点：/__setup?upstream=... → 持久化上游地址并 302 进应用
        if ("/__setup".equals(uri)) {
            String up = session.getParms().get("upstream");
            if (up != null && (up.startsWith("http://") || up.startsWith("https://"))) {
                upstream = up.trim().replaceAll("/+$", "");
                prefs.edit().putString("upstream", upstream).apply();
            }
            Response r = NanoHTTPD.newFixedLengthResponse(Response.Status.REDIRECT, "text/plain", "");
            r.addHeader("Location", "/");
            return r;
        }
        // ② 透传转发
        try {
            return forward(session, uri);
        } catch (Exception e) {
            return NanoHTTPD.newFixedLengthResponse(
                    Response.Status.INTERNAL_ERROR, "text/plain",
                    "proxy error: " + e.getClass().getSimpleName() + " " + e.getMessage());
        }
    }

    private Response forward(IHTTPSession session, String uri) throws Exception {
        Method method = session.getMethod();
        String query = session.getQueryParameterString();
        String target = upstream + uri + (query == null || query.isEmpty() ? "" : "?" + query);

        HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setInstanceFollowRedirects(false);

        // 请求头：透传（Host/Content-Length/Connection 由连接器自己管）
        for (Map.Entry<String, String> h : session.getHeaders().entrySet()) {
            String k = h.getKey();
            if (k == null) continue;
            String lk = k.toLowerCase();
            if (lk.equals("host") || lk.equals("content-length") || lk.equals("connection")) continue;
            try {
                conn.setRequestProperty(k, h.getValue());
            } catch (Exception ignore) { /* 非法头跳过 */ }
        }
        // 关键：注入云网关要求的会话亲和头
        conn.setRequestProperty("x-session-id", sessionId);

        // 请求体（POST/PUT/PATCH/DELETE with body）
        boolean hasBody = method != Method.GET && method != Method.HEAD;
        conn.setRequestMethod(method.name());
        if (hasBody) {
            InputStream in = session.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while (in != null && (n = in.read(buf)) > 0) bos.write(buf, 0, n);
            byte[] body = bos.toByteArray();
            conn.setDoOutput(true);
            if (body.length > 0) {
                conn.setFixedLengthStreamingMode(body.length);
                conn.getOutputStream().write(body);
            } else {
                conn.setFixedLengthStreamingMode(0);
            }
        }

        int code = conn.getResponseCode();
        if (code == -1) {
            throw new IllegalStateException("no response code from upstream");
        }

        // 响应头透传（跳过逐跳头）
        InputStream bodyStream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        Response.IStatus status = statusOf(code, conn.getResponseMessage());
        String mime = conn.getContentType();

        Response r;
        if (bodyStream != null && code != 204 && code != 304) {
            r = NanoHTTPD.newChunkedResponse(status, mime, bodyStream);
        } else {
            r = NanoHTTPD.newFixedLengthResponse(status, mime, "");
        }
        for (int i = 0; ; i++) {
            String key = conn.getHeaderFieldKey(i);
            String val = conn.getHeaderField(i);
            if (key == null && val == null) break;
            if (key == null) continue;
            String lk = key.toLowerCase();
            if (lk.equals("transfer-encoding") || lk.equals("content-length")
                    || lk.equals("connection")) continue;
            r.addHeader(key, val);
        }
        return r;
    }

    /** NanoHTTPD Status.lookup 对未知码返回 null —— 自定义兜底 */
    private static Response.IStatus statusOf(int code, String msg) {
        Response.Status s = Response.Status.lookup(code);
        if (s != null) return s;
        final int c = code;
        final String m = msg == null ? "" : msg;
        return new Response.IStatus() {
            @Override public int getRequestStatus() { return c; }
            @Override public String getDescription() { return c + " " + m; }
        };
    }
}
