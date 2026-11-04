# -*- coding: utf-8 -*-
"""
VERIFY-4 补充探针:模型为什么写了裸 [M数字] 却仍无引用块?
同时捕获 /api/chat 的【请求体(带 [M数字] 历史标注)】与【响应原文】,
核验模型写的编号 vs quoteMap 实际存在的编号(验证「下一号自标注」假设)。
"""
import json
import pathlib
import re
import time
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
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

pairs = []  # [{req_history_labels, resp_text}]


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
            return ((got && got.value) || []).map(m => ({
                role: m.role, content: (m.content || (m.voice ? (m.voice.localText||m.voice.transcript) : '') || '').slice(0, 80),
                quote: m.quote ? m.quote.content.slice(0, 60) : null,
            }));
        }""",
        f"wx-chat-msgs:{CHAR_ID}",
    )


def wait_ai_done(page, quiet_ms=7000, timeout_ms=150000):
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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()

        def on_response(resp):
            try:
                if "/api/chat" not in resp.url or resp.request.method != "POST":
                    return
                post = resp.request.post_data or ""
                hist_labels = []
                try:
                    j = json.loads(post)
                    for m in j.get("messages") or []:
                        c = m.get("content", "")
                        mm = re.match(r"\s*\[(M\d+)\]", c)
                        if mm:
                            hist_labels.append((mm.group(1), c[mm.end():mm.end() + 40].replace("\n", " ")))
                except Exception:
                    pass
                txt = resp.text()
                if txt and not txt.lstrip().startswith("{"):
                    pairs.append({"history": hist_labels, "resp": txt[:1500]})
            except Exception:
                pass

        page.on("response", on_response)

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        page.evaluate("""async (contacts) => {
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
        }""", SEED_CONTACTS)
        page.evaluate("""async (key) => {
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
        }""", f"wx-chat-msgs:{CHAR_ID}")
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
        try:
            page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=10000)
        except Exception:
            page.wait_for_selector('[data-testid="wx-login-account"]', timeout=20000)
            page.fill('[data-testid="wx-login-account"]', "13800001234")
            page.fill('[data-testid="wx-login-password"]', "123456")
            page.click('[data-testid="wx-login-submit"]')
            page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=20000)
        page.click('[data-testid="wx-tab-contacts"]')
        page.wait_for_selector('[data-testid="wx-contact-苏晴"]', timeout=10000)
        page.click('[data-testid="wx-contact-苏晴"]')
        page.wait_for_selector('[data-testid="wx-fdetail-chat"]', timeout=10000)
        page.click('[data-testid="wx-fdetail-chat"]')
        page.wait_for_selector('[data-testid="wx-chat-input"]', timeout=15000)
        time.sleep(1.0)

        for text in ["周末我们去爬山好不好", "对了公司楼下新开了家甜品店"]:
            page.fill('[data-testid="wx-chat-input"]', text)
            page.click('[data-testid="wx-chat-send"]')
            time.sleep(2.0)
        wait_ai_done(page)
        time.sleep(1.0)
        page.screenshot(path=str(OUT / "v4p-probe.png"), timeout=15000)

        print("\n===== 每轮:请求历史标注 vs 模型输出 =====", flush=True)
        for i, pr in enumerate(pairs):
            labels = pr["history"]
            max_label = max((int(l[0][1:]) for l in labels), default=0)
            resp = pr["resp"]
            wrote = re.findall(r"\[\s*M\s*(\d{1,5})\s*\]", resp)
            wrote_full = re.findall(r"\[引用[:：]\s*M?\s*(\d+)", resp)
            print(f"--- 轮 {i}: 历史标注到 M{max_label}(共 {len(labels)} 条带标注)", flush=True)
            for l in labels[-4:]:
                print(f"    {l[0]}: {l[1]}", flush=True)
            print(f"    模型输出裸编号: {wrote} / 完整引用: {wrote_full}", flush=True)
            if wrote or wrote_full:
                print(f"    响应片段: {resp[:200]!r}", flush=True)
        msgs = read_msgs(page)
        print("\n===== 最终消息(quote 字段) =====", flush=True)
        for m in msgs:
            print(f"- [{m['role']}] quote={m['quote']} :: {m['content']}", flush=True)
        dom = page.eval_on_selector_all('[data-testid="wx-quote-block"]',
                                        "els => els.map(e => e.textContent.trim())")
        print("DOM 引用块:", dom, flush=True)
        pathlib.Path("/home/z/my-project/tmp-analysis/verify4-probe.json").write_text(
            json.dumps({"pairs": pairs, "msgs": msgs, "dom": dom}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
