# -*- coding: utf-8 -*-
"""
VERIFY-4 复验:微信 AI 引用回复三层修复
  修复1 解析层容错:消息边界处裸 [M数字] → 自动补全 [引用:M数字](chat-rich.extractRichActionParts)
  修复2 提示词强化:✅[引用:M9] / ❌[M9] 正反例(已核在源码)
  修复3 语音气泡补渲染引用块(WxQuoteBlock)

验证设计(保留默认语音升级,真实模型链路):
  R1 连发两条话题消息 → 等 AI 回复完 → 查引用块(DOM+落库)、指向、挂文字/语音气泡、残留
  R2 若无引用再发一轮 → 再查
  P  (确定性)mock OpenAI SSE 返回【裸 [M数字]】 → 直接验证修复1容错层:裸编号也能出引用块
全程捕获 /api/chat 响应原文,区分「模型直接写对」vs「容错层兜底」两条成功路径。
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
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify4-report.json")

CHAR_ID = "c-suqing-v3"
USER_ID = "u-main-v3"
MOCK_PORT = 18925

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

results = []
chat_responses = []   # [{round, resp_text}] 模型原始输出
console_errors = []
page_errors = []
http_4xx_5xx = []


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    try:
        page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000)
        print(f"    📸 {name}.png", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)


def read_msgs(page):
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
                isVoice: m.kind === 'voice',
                voiceText: m.voice ? (m.voice.localText || m.voice.transcript || '').slice(0, 150) : null,
                quote: m.quote ? { name: m.quote.name, content: (m.quote.content || '').slice(0, 150) } : null,
            }));
        }""",
        f"wx-chat-msgs:{CHAR_ID}",
    )


def analyze_quotes(page):
    """DOM 引用块全景:内容 + 挂在哪种气泡下(文字/语音) + 行内语音气泡计数"""
    dom = page.eval_on_selector_all(
        '[data-testid="wx-quote-block"]',
        """els => els.map(e => {
            const text = (e.textContent || '').trim().slice(0, 140);
            // 向上找消息行 [data-mid]
            let row = e.closest('[data-mid]');
            const inVoice = !!(row && row.querySelector('[data-testid="voice-bubble"]'));
            const mid = row ? row.getAttribute('data-mid') : null;
            return { text, inVoice, mid };
        })""")
    msgs = read_msgs(page)
    me_texts = [m["content"] for m in msgs if m["role"] == "me"]
    ai = [m for m in msgs if m["role"] == "peer"]
    quoted = [m for m in ai if m["quote"]]
    residue = [
        {"role": m["role"], "kind": m["kind"], "content": m["content"] or (m["voiceText"] or "")}
        for m in msgs
        if re.search(r"\[引用[:：]", m["content"] or "") or re.search(r"\[M\d+\]", m["content"] or (m["voiceText"] or ""))
    ]
    pointed = []
    for q in quoted:
        content = q["quote"]["content"]
        hit = next((t for t in me_texts if t[:10] and t[:10] in content), None)
        pointed.append({"quote": content, "voice": q["isVoice"], "matched_user_msg": bool(hit)})
    return dom, msgs, me_texts, ai, quoted, residue, pointed


def wait_ai_done(page, quiet_ms=7000, timeout_ms=180000):
    t0 = time.time()
    last_n = -1
    last_change = time.time()
    while time.time() - t0 < timeout_ms / 1000.0:
        typing = page.locator('[data-testid="wx-stream-typing"]').count()
        try:
            n = len(read_msgs(page))
        except Exception:
            n = -1
        if typing > 0 or n != last_n:
            last_n = n
            last_change = time.time()
        elif time.time() - last_change >= quiet_ms / 1000.0:
            return True
        time.sleep(1.0)
    return False


def unlock_and_reach_chat(page):
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
    # 登录态丢了就重新登录
    try:
        page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=12000)
        relogged = False
    except Exception:
        page.wait_for_selector('[data-testid="wx-login-account"]', timeout=20000)
        page.fill('[data-testid="wx-login-account"]', "13800001234")
        page.fill('[data-testid="wx-login-password"]', "123456")
        page.click('[data-testid="wx-login-submit"]')
        page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=20000)
        relogged = True
    page.click('[data-testid="wx-tab-contacts"]')
    page.wait_for_selector(f'[data-testid="wx-contact-苏晴"]', timeout=10000)
    page.click(f'[data-testid="wx-contact-苏晴"]')
    page.wait_for_selector('[data-testid="wx-fdetail-chat"]', timeout=10000)
    page.click('[data-testid="wx-fdetail-chat"]')
    page.wait_for_selector('[data-testid="wx-chat-input"]', timeout=15000)
    time.sleep(1.0)
    return relogged


def classify_model_output():
    """从捕获的模型原始输出里判定格式路径"""
    raw_texts = [c["resp_text"] for c in chat_responses if c.get("resp_text")]
    joined = "\n".join(raw_texts)
    bare = re.findall(r"(?:^|\n|\|)\s*\[(M\d+)\]", joined) + re.findall(r"^\s*\[(M\d+)\]", joined, re.M)
    full = re.findall(r"\[引用[:：]\s*M?\d+", joined)
    return {
        "raw_outputs": [t[:400] for t in raw_texts],
        "bare_M_count": len(re.findall(r"\[\s*M\s*\d{1,5}\s*\]", joined)),
        "full_quote_count": len(re.findall(r"\[引用[:：]", joined)),
        "raw_snippets": [s.strip()[:200] for s in joined.split("\n") if re.search(r"\[\s*M\s*\d+\]|\[引用", s)][:8],
    }


# ---------------- mock(确定性验证修复1容错层:返回裸 [M数字]) ----------------

class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        msgs = body.get("messages") or []

        def find_m(substr):
            for m in msgs:
                if m.get("role") == "user" and substr in m.get("content", ""):
                    mm = re.match(r"\s*\[(M\d+)\]", m.get("content", ""))
                    if mm:
                        return mm.group(1)
            return None

        # 故意只输出【裸 [M数字]】—— 验证容错层能兜底
        m_book = find_m("书")
        m_pot = find_m("火锅")
        if m_book and m_pot:
            reply = (f"[{m_pot}] 火锅好呀,锅底我要番茄牛腩双拼！\n"
                     f"[{m_book}] 太棒了,那本书我跟你说过超好看的,你读到第几章啦？")
        elif m_book:
            reply = f"[{m_book}] 太棒了,那本书我跟你说过超好看的,你读到第几章啦？"
        elif m_pot:
            reply = f"[{m_pot}] 火锅好呀,锅底我要番茄牛腩双拼！"
        else:
            reply = "好呀好呀,我都听你的！"
        data = b""
        for c in [reply[i:i + 24] for i in range(0, len(reply), 24)]:
            payload = json.dumps({"choices": [{"delta": {"content": c}}]}, ensure_ascii=False)
            data += f"data: {payload}\n\n".encode("utf-8")
        data += b"data: [DONE]\n\n"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN",
                                  has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append({"type": m.type, "text": m.text})
                if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("response", lambda r: http_4xx_5xx.append({"url": r.url, "status": r.status}) if r.status >= 400 else None)

        def on_response(resp):
            try:
                if "/api/chat" not in resp.url or resp.request.method != "POST":
                    return
                txt = resp.text()
                if txt and not txt.lstrip().startswith("{"):
                    chat_responses.append({"url": resp.url, "resp_text": txt[:3000]})
            except Exception:
                pass

        page.on("response", on_response)

        # ---------- 0. 启动 + 种子(沿用上轮联系人;重新 put 幂等) ----------
        print("== Phase 0: boot & seed ==", flush=True)
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        page.evaluate(
            """async (contacts) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
                });
                for (const c of contacts) {
                    await new Promise((res, rej) => {
                        const tx = db.transaction('contacts', 'readwrite');
                        tx.objectStore('contacts').put(c);
                        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                    });
                }
                db.close();
                return true;
            }""",
            SEED_CONTACTS,
        )
        # 清旧消息 + 重置语音计数(保证本轮从零观察;语音升级保持默认开启)
        page.evaluate(
            """async (key) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
                });
                await new Promise((res, rej) => {
                    const tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').delete(key);
                    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                });
                db.close();
                localStorage.removeItem('ai-voice-counters');
                return true;
            }""",
            f"wx-chat-msgs:{CHAR_ID}",
        )
        page.reload(wait_until="domcontentloaded")
        relogged = unlock_and_reach_chat(page)
        shot(page, "v4-01-chat-open")
        log("0", "解锁→微信→苏晴聊天页", True, f"重新登录={relogged};输入框出现")

        # ---------- Round 1 ----------
        print("== Round 1 (真实模型,默认语音升级开启) ==", flush=True)
        page.fill('[data-testid="wx-chat-input"]', "今天晚上我打算吃火锅")
        page.click('[data-testid="wx-chat-send"]')
        time.sleep(2.0)
        page.fill('[data-testid="wx-chat-input"]', "你上次推荐我的那本书我买到啦")
        page.click('[data-testid="wx-chat-send"]')
        done1 = wait_ai_done(page)
        time.sleep(1.0)
        shot(page, "v4-02-round1")
        dom, msgs, me_texts, ai, quoted, residue, pointed = analyze_quotes(page)
        log("R1", "连发两条 → AI 回复完成", done1,
            f"消息总数={len(msgs)}(AI {len(ai)});带 quote {len(quoted)} 条;DOM 引用块 {len(dom)} 个;"
            f"语音条 {sum(1 for m in ai if m['isVoice'])} 条")

        # ---------- Round 2(若第一轮无引用) ----------
        if not dom:
            print("== Round 2 ==", flush=True)
            page.fill('[data-testid="wx-chat-input"]', "明天降温记得穿外套")
            page.click('[data-testid="wx-chat-send"]')
            time.sleep(2.0)
            page.fill('[data-testid="wx-chat-input"]', "周末我们去哪玩")
            page.click('[data-testid="wx-chat-send"]')
            done2 = wait_ai_done(page)
            time.sleep(1.0)
            shot(page, "v4-03-round2")
            dom, msgs, me_texts, ai, quoted, residue, pointed = analyze_quotes(page)
            log("R2", "第二轮连发两条 → AI 回复完成", done2,
                f"消息总数={len(msgs)}(AI {len(ai)});带 quote {len(quoted)} 条;DOM 引用块 {len(dom)} 个;"
                f"语音条 {sum(1 for m in ai if m['isVoice'])} 条")

        # ---------- 真实链路结论 ----------
        fmt = classify_model_output()
        core_ok = (len(dom) > 0 and any(x["matched_user_msg"] for x in pointed) if pointed else False) or \
                  (len(dom) > 0 and any(x["quote"] and True for x in pointed))
        core_ok = len(dom) > 0 and any(x.get("matched_user_msg") for x in pointed)
        path = "容错层兜底(裸[M])" if fmt["bare_M_count"] > 0 and fmt["full_quote_count"] == 0 else \
               ("模型直写[引用:M]" if fmt["full_quote_count"] > 0 else "模型无引用意图输出")
        log("CORE", "真实链路:至少一条 AI 回复(文字或语音气泡)带引用块且指向用户消息",
            core_ok,
            f"DOM 引用块={len(dom)};其中语音气泡下={sum(1 for d in dom if d['inVoice'])}、文字气泡下={sum(1 for d in dom if not d['inVoice'])};"
            f"pointed={pointed};成功路径={path}")
        log("RESIDUE", "正文/语音转写无裸 [M数字] 与 [引用: 残留", len(residue) == 0,
            f"残留={residue[:4]}")

        # 滚到底截全景
        page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('div'));
            els.filter(e => e.className && String(e.className).includes('overflow-y-auto'))
                .forEach(e => { try { e.scrollTop = e.scrollHeight; } catch {} });
        }""")
        time.sleep(0.6)
        shot(page, "v4-04-real-final")

        # ---------- P:确定性验证修复1(mock 只输出裸 [M数字]) ----------
        print("== P: mock 输出裸 [M数字] → 容错层验证 ==", flush=True)
        srv = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockHandler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        time.sleep(0.3)
        mock_dom = []
        try:
            page.evaluate(
                """async (cfg) => {
                    const db = await new Promise((res, rej) => {
                        const r = indexedDB.open('ios-phone-db');
                        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
                    });
                    await new Promise((res, rej) => {
                        const tx = db.transaction('settings', 'readwrite');
                        tx.objectStore('settings').put({ key: 'apiConfig', value: cfg });
                        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                    });
                    db.close();
                    return true;
                }""",
                {"baseUrl": f"http://127.0.0.1:{MOCK_PORT}/v1/chat/completions",
                 "apiKey": "mock-key", "model": "mock-model",
                 "temperature": 0.7, "maxTokens": 2048},
            )
            # settings 改动需要重载才被读取(store.load 只在开机时读)
            page.reload(wait_until="domcontentloaded")
            unlock_and_reach_chat(page)
            page.fill('[data-testid="wx-chat-input"]', "今天晚上我打算吃火锅")
            page.click('[data-testid="wx-chat-send"]')
            time.sleep(1.5)
            page.fill('[data-testid="wx-chat-input"]', "你上次推荐我的那本书我买到啦")
            page.click('[data-testid="wx-chat-send"]')
            wait_ai_done(page, quiet_ms=6000, timeout_ms=90000)
            time.sleep(1.0)
            shot(page, "v4-05-mock-bare-M")
            mock_dom, mock_msgs, mock_me, mock_ai, mock_quoted, mock_residue, mock_pointed = analyze_quotes(page)
            log("P1", "mock 只输出裸 [M数字] → 容错层补全 → DOM 出现引用块",
                len(mock_dom) > 0,
                f"DOM 引用块 {len(mock_dom)} 个;内容={[d['text'] for d in mock_dom]};"
                f"语音气泡下={sum(1 for d in mock_dom if d['inVoice'])}")
            log("P2", "容错引用指向用户真实消息", any(x.get("matched_user_msg") for x in mock_pointed),
                f"pointed={mock_pointed}")
            log("P3", "容错链路正文无裸编号/引用标记残留", len(mock_residue) == 0,
                f"残留={mock_residue[:3]}")
            log("P4", "语音气泡分支渲染引用块(修复3;mock 轮语音升级命中时)",
                (sum(1 for d in mock_dom if d["inVoice"]) > 0) or (sum(1 for m in mock_ai if m["isVoice"]) == 0),
                f"语音条 {sum(1 for m in mock_ai if m['isVoice'])} 条;引用块挂语音气泡 {sum(1 for d in mock_dom if d['inVoice'])} 个"
                f"(无语音条时该项以「语音条=0」跳过)")
        finally:
            srv.shutdown()

        log("CONSOLE", "控制台无 error/pageerror", len(console_errors) == 0 and len(page_errors) == 0,
            f"console error={len(console_errors)};pageerror={len(page_errors)};"
            f"4xx/5xx={http_4xx_5xx[:6]};console 样例={console_errors[:4]}")

        summary = {
            "results": results,
            "real_dom_quotes": dom,
            "real_ai_messages": [{"kind": m["kind"], "content": (m["content"] or m["voiceText"] or "")[:120],
                                  "isVoice": m["isVoice"], "quote": m["quote"]} for m in ai],
            "model_raw_format": fmt,
            "success_path": path,
            "pointed": pointed,
            "residue": residue,
            "mock_part": {"dom": mock_dom,
                          "ai": [{"kind": m["kind"], "content": (m["content"] or m["voiceText"] or "")[:120],
                                  "isVoice": m["isVoice"], "quote": m["quote"]} for m in mock_ai],
                          "residue": mock_residue, "pointed": mock_pointed},
            "console_errors": console_errors,
            "page_errors": page_errors,
            "http_4xx_5xx": http_4xx_5xx,
        }
        REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n===== SUMMARY =====", flush=True)
        for r in results:
            print(f"  {'PASS' if r['ok'] else 'FAIL'} {r['step']} {r['name']}", flush=True)
        browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
