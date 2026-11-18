# -*- coding: utf-8 -*-
"""
VERIFY-3 补充深挖(失败根因定位):
  A. 捕获真实链路(内置模型 forceSdk)完整请求体 → 检查系统提示词里【引用回复】规则是否在位
  B. 本地 mock OpenAI SSE 服务 + 注入 apiConfig → 模型返回规范 [引用:M编号] 标记 →
     验证「标记 → wx-quote-block 引用块」执行/渲染管线是否正常(区分:管线坏 vs 模型不守格式)
"""
import json
import pathlib
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify3-deep-report.json")

MOCK_PORT = 18923
CHAR_ID = "c-suqing-v3"
USER_ID = "u-main-v3"

PERSONA = (
    "你叫苏晴,是阿泽交往两年的女朋友,22 岁,大学生。性格温柔又有点小话痨,"
    "说话口语化、带点撒娇。你聊天时喜欢把对方的话一句一句接住,认真回应每一句话。"
)

SEED_CONTACTS = [
    {"id": USER_ID, "kind": "user", "ownerId": None, "name": "阿泽", "nickname": None,
     "gender": "男", "age": None, "height": None, "weight": None, "persona": None,
     "background": None, "occupation": None, "company": None, "region": None, "relation": None,
     "phone": "13800001234", "wechatId": "aze_wx_v3", "wechatPassword": "123456",
     "qqId": None, "qqPassword": None, "avatar": None, "isFriend": True, "friendWx": True,
     "createdAt": "2025-01-01T00:00:00.000Z"},
    {"id": CHAR_ID, "kind": "char", "ownerId": None, "name": "苏晴", "nickname": None,
     "gender": "女", "age": "22", "height": None, "weight": None, "persona": PERSONA,
     "background": None, "occupation": "大学生", "company": None, "region": None,
     "relation": "恋人", "phone": "13900005678", "wechatId": "suqing_wx_v3",
     "wechatPassword": None, "qqId": None, "qqPassword": None, "avatar": None,
     "isFriend": True, "friendWx": True, "createdAt": "2025-01-02T00:00:00.000Z"},
]

captured_requests = []  # 完整 /api/chat 请求体(Part A)
mock_hits = []          # mock 收到的请求概要(Part B)
results = []
http_4xx_5xx = []       # 4xx/5xx 响应 URL 记录


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    try:
        page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000)
        print(f"    📸 {name}.png", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)


# ---------------- Part B 的 mock OpenAI SSE 服务 ----------------

class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # 静默
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except Exception:
            body = {}
        msgs = body.get("messages") or []
        last_user = next((m.get("content", "") for m in reversed(msgs) if m.get("role") == "user"), "")
        # 「聪明的 mock」:从历史里找用户两条消息的 [M编号],生成规范引用标记回复
        def find_m(substr):
            for m in msgs:
                if m.get("role") == "user" and substr in m.get("content", ""):
                    mm = re.match(r"\s*\[(M\d+)\]", m.get("content", ""))
                    if mm:
                        return mm.group(1)
            return None
        m1 = find_m("拉面")
        m2 = find_m("电影")
        mock_hits.append({"last_user": last_user[:120], "m1": m1, "m2": m2})
        if m1 and m2:
            reply = (f"[引用:{m1}] 哈哈,兰州拉面听起来就很香,我都馋了！\n"
                     f"[引用:{m2}] 那部电影我等你好久了,周六下午一起去看吧！")
        elif m1:
            reply = f"[引用:{m1}] 哈哈,兰州拉面听起来就很香,我都馋了！周末带我去吃嘛！"
        else:
            reply = "好呀好呀,我都听你的！"
        # SSE 流式输出(整段拆几个 chunk)
        chunks = [reply[i:i + 24] for i in range(0, len(reply), 24)]
        data = b""
        for c in chunks:
            payload = json.dumps({"choices": [{"delta": {"content": c}}]}, ensure_ascii=False)
            data += f"data: {payload}\n\n".encode("utf-8")
        data += b"data: [DONE]\n\n"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def start_mock():
    srv = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


# ---------------- 通用流程 ----------------

def seed(page, with_api_config=False):
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
    page.evaluate(
        """async (args) => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('ios-phone-db');
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            const putContact = (rec) => new Promise((res, rej) => {
                const tx = db.transaction('contacts', 'readwrite');
                tx.objectStore('contacts').put(rec);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
            for (const c of args.contacts) await putContact(c);
            if (args.apiConfig) {
                await new Promise((res, rej) => {
                    const tx = db.transaction('settings', 'readwrite');
                    tx.objectStore('settings').put({ key: 'apiConfig', value: args.apiConfig });
                    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                });
            }
            db.close();
            return true;
        }""",
        {"contacts": SEED_CONTACTS,
         "apiConfig": ({"baseUrl": f"http://127.0.0.1:{MOCK_PORT}/v1/chat/completions",
                        "apiKey": "mock-key", "model": "mock-model",
                        "temperature": 0.7, "maxTokens": 2048} if with_api_config else None)},
    )


def unlock_login_open_chat(page):
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
    page.mouse.move(195, 790)
    page.mouse.down()
    for y in range(770, 240, -30):
        page.mouse.move(195, y)
        time.sleep(0.02)
    page.mouse.up()
    page.wait_for_selector("text=向上轻扫以解锁", state="detached", timeout=10000)
    time.sleep(0.8)
    icon = page.locator('[aria-label="打开微信"]')
    for _ in range(8):
        box = icon.bounding_box()
        if box and -5 <= box["x"] and box["x"] + box["width"] <= 395:
            break
        page.mouse.move(340, 400)
        page.mouse.down()
        for x in range(330, 45, -30):
            page.mouse.move(x, 400)
            time.sleep(0.02)
        page.mouse.up()
        time.sleep(0.7)
    icon.click()
    page.wait_for_selector('[data-testid="wx-login-account"]', timeout=20000)
    page.fill('[data-testid="wx-login-account"]', "13800001234")
    page.fill('[data-testid="wx-login-password"]', "123456")
    page.click('[data-testid="wx-login-submit"]')
    page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=20000)
    page.click('[data-testid="wx-tab-contacts"]')
    page.wait_for_selector(f'[data-testid="wx-contact-苏晴"]', timeout=10000)
    page.click(f'[data-testid="wx-contact-苏晴"]')
    page.wait_for_selector('[data-testid="wx-fdetail-chat"]', timeout=10000)
    page.click('[data-testid="wx-fdetail-chat"]')
    page.wait_for_selector('[data-testid="wx-chat-input"]', timeout=15000)
    time.sleep(0.8)


def read_msgs(page, key):
    return page.evaluate(
        """async (key) => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('ios-phone-db');
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            const got = await new Promise((res, rej) => {
                const tx = db.transaction('kv', 'readonly');
                const rq = tx.objectStore('kv').get(key);
                rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
            });
            db.close();
            const msgs = (got && got.value) || [];
            return msgs.map(m => ({
                role: m.role, kind: m.kind || 'text',
                content: (m.content || '').slice(0, 200),
                hasVoice: !!m.voice,
                voiceText: m.voice ? (m.voice.localText || m.voice.transcript || '').slice(0, 120) : null,
                quote: m.quote ? { name: m.quote.name, content: (m.quote.content || '').slice(0, 120) } : null,
            }));
        }""",
        key,
    )


def wait_ai_done(page, key, quiet_ms=6000, timeout_ms=90000):
    t0 = time.time()
    last_n = -1
    last_change = time.time()
    while time.time() - t0 < timeout_ms / 1000.0:
        typing = page.locator('[data-testid="wx-stream-typing"]').count()
        try:
            n = len(read_msgs(page, key))
        except Exception:
            n = -1
        if typing > 0 or n != last_n:
            last_n = n
            last_change = time.time()
        elif time.time() - last_change >= quiet_ms / 1000.0:
            return True
        time.sleep(1.0)
    return False


def run():
    console_errors_a, console_errors_b = [], []
    page_errors_b = []

    # ================= Part A:真实链路完整请求捕获 =================
    print("== Part A: 捕获真实(内置模型)链路完整请求 ==", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors_a.append({"type": m.type, "text": m.text})
                if m.type == "error" else None)

        def on_request(req):
            try:
                if "/api/chat" not in req.url or req.method != "POST":
                    return
                post = req.post_data or ""
                if '"messages"' in post:
                    j = json.loads(post)
                    if j.get("messages"):
                        captured_requests.append(j)
            except Exception:
                pass

        page.on("request", on_request)
        page.on("response", lambda r: http_4xx_5xx.append({"url": r.url, "status": r.status}) if r.status >= 400 else None)
        seed(page, with_api_config=False)
        unlock_login_open_chat(page)
        page.fill('[data-testid="wx-chat-input"]', "今天中午吃了兰州拉面,特别香")
        page.click('[data-testid="wx-chat-send"]')
        time.sleep(2.0)
        page.fill('[data-testid="wx-chat-input"]', "对了,你上次说的那部电影我想去看")
        page.click('[data-testid="wx-chat-send"]')
        wait_ai_done(page, f"wx-chat-msgs:{CHAR_ID}")
        shot(page, "v3d-A-real-replies")
        browser.close()

    # 分析捕获的请求(含 forceSdk 兜底链路)
    system_prompt = ""
    last_payload_tail = []
    force_sdk_count = 0
    if captured_requests:
        force_sdk_count = sum(1 for j in captured_requests if j.get("forceSdk"))
        biggest = max(captured_requests, key=lambda j: len(j["messages"]))
        msgs = biggest["messages"]
        if msgs and msgs[0]["role"] == "system":
            system_prompt = msgs[0]["content"]
        last_payload_tail = [m["content"][:160] for m in msgs[-8:]]
    has_rule = "【引用回复】" in system_prompt
    has_m_labels = bool(re.search(r"\[M\d+\]", "".join(last_payload_tail)))
    rule_excerpt = ""
    if has_rule:
        i = system_prompt.find("【引用回复】")
        rule_excerpt = system_prompt[i:i + 260]
    log("A1", "系统提示词包含【引用回复】规则(修改后的规则在真实链路下发)", has_rule,
        f"system 长度={len(system_prompt)} 字;规则摘录={rule_excerpt[:200]}")
    log("A2", "历史消息带 [M数字] 门牌号标注", has_m_labels,
        f"末 8 条预览={[t[:60] for t in last_payload_tail[:6]]}")

    # ================= Part B:mock 模型返回规范 [引用:M编号] =================
    print("== Part B: mock 模型 + 规范引用标记 → 管线验证 ==", flush=True)
    srv = start_mock()
    time.sleep(0.3)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                      device_scale_factor=2, locale="zh-CN")
            page = ctx.new_page()
            page.on("console", lambda m: console_errors_b.append({"type": m.type, "text": m.text})
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: page_errors_b.append(str(e)))
            seed(page, with_api_config=True)
            unlock_login_open_chat(page)
            # 关闭本会话的 AI 语音升级(默认 often=每 3 条 1 条变语音,语音气泡分支不渲染引用块):
            # 关掉后所有 AI 回复保持文字气泡 → 单独验证引用块渲染不受语音升级干扰
            page.evaluate("""(k) => {
                const map = JSON.parse(localStorage.getItem('ai-voice-freq') || '{}');
                map[k] = 'off';
                localStorage.setItem('ai-voice-freq', JSON.stringify(map));
            }""", f"wx:{CHAR_ID}")
            # 发两条消息
            page.fill('[data-testid="wx-chat-input"]', "今天中午吃了兰州拉面,特别香")
            page.click('[data-testid="wx-chat-send"]')
            time.sleep(1.5)
            page.fill('[data-testid="wx-chat-input"]', "对了,你上次说的那部电影我想去看")
            page.click('[data-testid="wx-chat-send"]')
            wait_ai_done(page, f"wx-chat-msgs:{CHAR_ID}")
            time.sleep(1.0)
            shot(page, "v3d-B-quoted-replies")

            dom_quotes = page.eval_on_selector_all(
                '[data-testid="wx-quote-block"]',
                "els => els.map(e => (e.textContent || '').trim().slice(0, 140))")
            msgs = read_msgs(page, f"wx-chat-msgs:{CHAR_ID}")
            ai = [m for m in msgs if m["role"] == "peer"]
            quoted = [m for m in ai if m["quote"]]
            residue = [m for m in msgs if re.search(r"\[引用[:：]|\[M\d+\]", m["content"])]
            my_texts = [m["content"] for m in msgs if m["role"] == "me"]
            pointed = []
            for q in quoted:
                hit = next((t for t in my_texts if t[:10] and t[:10] in q["quote"]["content"]), None)
                pointed.append({"quote": q["quote"]["content"], "matched": bool(hit)})
            log("B1", "mock 输出 [引用:M编号] → DOM 出现 wx-quote-block 引用块",
                len(dom_quotes) > 0, f"DOM 引用块 {len(dom_quotes)} 个;内容={dom_quotes}")
            log("B2", "引用块内容指向用户真实消息(名字:内容)",
                any(x["matched"] for x in pointed) if pointed else False,
                f"AI 消息 {len(ai)} 条,带 quote 字段 {len(quoted)} 条;pointed={pointed}")
            log("B2b", "带 quote 的 AI 消息全部渲染出引用块(语音升级关闭后)",
                len(quoted) > 0 and len(dom_quotes) == len(quoted),
                f"quote 字段 {len(quoted)} 条 vs DOM 引用块 {len(dom_quotes)} 个(应相等)")
            log("B3", "标记不在正文残留(引用标记被正确剥除)",
                len(residue) == 0, f"残留={residue}")
            log("B4", "mock 收到的请求带 [M编号] 历史(mock 能对号入座)",
                any(h["m1"] for h in mock_hits),
                f"mock 命中={mock_hits}")
            log("B5", "控制台无 error/pageerror(mock 链路)",
                len(console_errors_b) == 0 and len(page_errors_b) == 0,
                f"console={len(console_errors_b)};pageerror={len(page_errors_b)};"
                f"4xx/5xx={http_4xx_5xx};console 样例={console_errors_b[:3]}")
            part_b = {"dom_quotes": dom_quotes, "ai_messages": ai, "quoted": quoted, "residue": residue,
                      "mock_hits": mock_hits, "console_errors": console_errors_b, "page_errors": page_errors_b}
    finally:
        srv.shutdown()

    log("A3", "Part A 控制台无 error", len(console_errors_a) == 0,
        f"console error={len(console_errors_a)};4xx/5xx={http_4xx_5xx};forceSdk 请求数={force_sdk_count}")

    REPORT.write_text(json.dumps({
        "results": results,
        "system_prompt_full": system_prompt,
        "rule_excerpt": rule_excerpt,
        "history_tail": last_payload_tail,
        "captured_request_count": len(captured_requests),
        "http_4xx_5xx": http_4xx_5xx,
        "part_b": part_b,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n===== SUMMARY =====", flush=True)
    for r in results:
        print(f"  {'PASS' if r['ok'] else 'FAIL'} {r['step']} {r['name']}", flush=True)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
