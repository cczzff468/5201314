# -*- coding: utf-8 -*-
"""
VERIFY-5 最终复验:微信 AI 引用回复(含本轮新修复「编号越界兜底」)
成功路径三选一都算通过:
  A 模型直写 [引用:M编号] 且编号有效
  B 模型写裸 [M数字](边界处) → 容错层补全 → 编号有效
  C 模型编号越界(N>quoteMap.size) → 兜底引用最近一条用户消息
验证:清会话 → 连发两条 → 等 AI → 查引用块/指向/挂载位置 → 必要时第二轮
     → 抓 /api/chat 请求(历史标注)+响应原文 → 编号对照 → 残留/控制台检查
"""
import json
import pathlib
import re
import time
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify5-report.json")

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

results = []
chat_pairs = []   # [{history:[(M,txt)], resp, msg_count_at_req}]
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
    dom = page.eval_on_selector_all(
        '[data-testid="wx-quote-block"]',
        """els => els.map(e => {
            const text = (e.textContent || '').trim().slice(0, 140);
            const row = e.closest('[data-mid]');
            const inVoice = !!(row && row.querySelector('[data-testid="voice-bubble"]'));
            const mid = row ? row.getAttribute('data-mid') : null;
            return { text, inVoice, mid };
        })""")
    msgs = read_msgs(page)
    me_texts = [m["content"] for m in msgs if m["role"] == "me" and not m["isVoice"]]
    ai = [m for m in msgs if m["role"] == "peer"]
    quoted = [m for m in ai if m["quote"]]
    residue = []
    for m in msgs:
        blob = m["content"] or (m["voiceText"] or "")
        if re.search(r"\[引用[:：]", blob) or re.search(r"\[M\d+\]", blob):
            residue.append({"role": m["role"], "kind": m["kind"], "content": blob[:120]})
    pointed = []
    for q in quoted:
        content = q["quote"]["content"]
        hit = next((t for t in me_texts if t[:10] and t[:10] in content), None)
        pointed.append({"quote": content, "voice": q["isVoice"], "matched_user_msg": bool(hit),
                        "matched": (hit or "")[:60]})
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
    try:
        page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=10000)
        relogged = False
    except Exception:
        page.wait_for_selector('[data-testid="wx-login-account"]', timeout=20000)
        page.fill('[data-testid="wx-login-account"]', "13800001234")
        page.fill('[data-testid="wx-login-password"]', "123456")
        page.click('[data-testid="wx-login-submit"]')
        page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=20000)
        relogged = True
    page.click('[data-testid="wx-tab-contacts"]')
    page.wait_for_selector('[data-testid="wx-contact-苏晴"]', timeout=10000)
    page.click('[data-testid="wx-contact-苏晴"]')
    page.wait_for_selector('[data-testid="wx-fdetail-chat"]', timeout=10000)
    page.click('[data-testid="wx-fdetail-chat"]')
    page.wait_for_selector('[data-testid="wx-chat-input"]', timeout=15000)
    time.sleep(1.0)
    return relogged


def send_two(page, t1, t2):
    page.fill('[data-testid="wx-chat-input"]', t1)
    page.click('[data-testid="wx-chat-send"]')
    time.sleep(2.0)
    page.fill('[data-testid="wx-chat-input"]', t2)
    page.click('[data-testid="wx-chat-send"]')


def analyze_paths():
    """对照每次请求的历史标注与响应原文,判定成功路径"""
    per_turn = []
    for pr in chat_pairs:
        labels = pr.get("history") or []
        max_n = max((int(l[0][1:]) for l in labels), default=0)
        n_labels = len(labels)
        resp = pr.get("resp") or ""
        bare = re.findall(r"\[\s*M\s*(\d{1,5})\s*\]", resp)
        full = re.findall(r"\[引用[:：]\s*M?\s*(\d{1,5})", resp)
        bare_oob = [n for n in bare if int(n) > max_n]
        full_valid = [n for n in full if int(n) <= max_n]
        path = None
        if full_valid:
            path = "A 模型直写[引用:M编号](有效)"
        elif bare and bare_oob:
            path = "C 越界兜底(编号 N>历史最大,兜底引用最近用户消息)"
        elif bare:
            path = "B 容错补全(裸[M]且编号在界内)"
        per_turn.append({
            "history_max_M": max_n, "history_label_count": n_labels,
            "model_bare_M": bare, "model_full_quote": full,
            "bare_out_of_bounds": bare_oob, "full_valid": full_valid,
            "path": path,
            "resp_snippet": next((s.strip()[:180] for s in resp.split("\n") if re.search(r"\[\s*M\s*\d+|\[引用", s)), ""),
        })
    return per_turn


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
                post = resp.request.post_data or ""
                history = []
                try:
                    j = json.loads(post)
                    for m in j.get("messages") or []:
                        c = m.get("content", "")
                        mm = re.match(r"\s*\[(M\d+)\]", c)
                        if mm:
                            history.append((mm.group(1), c[mm.end():mm.end() + 50].replace("\n", " ")))
                except Exception:
                    pass
                txt = resp.text()
                if txt and not txt.lstrip().startswith("{"):
                    chat_pairs.append({"history": history, "resp": txt[:2000]})
            except Exception:
                pass

        page.on("response", on_response)

        # ---------- 0. 启动 + 种子 + 清会话 ----------
        print("== Phase 0: boot, seed, reset ==", flush=True)
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
            return true;
        }""", f"wx-chat-msgs:{CHAR_ID}")
        page.reload(wait_until="domcontentloaded")
        relogged = unlock_and_reach_chat(page)
        shot(page, "v5-01-chat-open")
        log("0", "解锁→微信→苏晴聊天页(会话已清空)", True,
            f"重新登录={relogged};旧消息已删除;语音升级保持默认开启")

        # ---------- Round 1 ----------
        print("== Round 1 ==", flush=True)
        send_two(page, "今晚我做了红烧排骨,超成功", "周末要不要一起去看展")
        done1 = wait_ai_done(page)
        time.sleep(1.0)
        shot(page, "v5-02-round1")
        dom, msgs, me_texts, ai, quoted, residue, pointed = analyze_quotes(page)
        log("R1", "连发两条 → AI 回复完成", done1,
            f"消息总数={len(msgs)}(AI {len(ai)});带 quote {len(quoted)} 条;DOM 引用块 {len(dom)} 个;"
            f"语音条 {sum(1 for m in ai if m['isVoice'])} 条")

        # ---------- Round 2(若第一轮无引用) ----------
        if not dom:
            print("== Round 2 ==", flush=True)
            send_two(page, "我今天被领导夸了", "晚上想吃日料")
            done2 = wait_ai_done(page)
            time.sleep(1.0)
            shot(page, "v5-03-round2")
            dom, msgs, me_texts, ai, quoted, residue, pointed = analyze_quotes(page)
            log("R2", "第二轮连发两条 → AI 回复完成", done2,
                f"消息总数={len(msgs)}(AI {len(ai)});带 quote {len(quoted)} 条;DOM 引用块 {len(dom)} 个;"
                f"语音条 {sum(1 for m in ai if m['isVoice'])} 条")

        # 滚到底截全景
        page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('div'));
            els.filter(e => e.className && String(e.className).includes('overflow-y-auto'))
                .forEach(e => { try { e.scrollTop = e.scrollHeight; } catch {} });
        }""")
        time.sleep(0.6)
        shot(page, "v5-04-final")

        # ---------- 结论 ----------
        core_ok = len(dom) > 0 and any(x.get("matched_user_msg") for x in pointed)
        paths = analyze_paths()
        chosen = next((t["path"] for t in paths if t["path"]), None)
        log("CORE", "至少一条 AI 回复(文字或语音气泡)带引用块且指向用户真实消息",
            core_ok,
            f"DOM 引用块={len(dom)}(语音气泡下 {sum(1 for d in dom if d['inVoice'])} / 文字气泡下 {sum(1 for d in dom if not d['inVoice'])});"
            f"pointed={pointed};成功路径={chosen}")
        log("RESIDUE", "正文/语音转写无裸 [M数字] 与 [引用: 残留", len(residue) == 0,
            f"残留={residue[:4]}")
        log("CONSOLE", "控制台无 error/pageerror", len(console_errors) == 0 and len(page_errors) == 0,
            f"console error={len(console_errors)};pageerror={len(page_errors)};"
            f"4xx/5xx={http_4xx_5xx[:6]};console 样例={console_errors[:4]}")

        summary = {
            "results": results,
            "core_pass": core_ok,
            "dom_quotes": dom,
            "pointed": pointed,
            "ai_messages": [{"kind": m["kind"], "isVoice": m["isVoice"],
                             "content": (m["content"] or m["voiceText"] or "")[:140],
                             "quote": m["quote"]} for m in ai],
            "my_messages": me_texts,
            "model_output_analysis": paths,
            "chat_pairs_raw": [{"history": pr["history"], "resp": pr["resp"][:800]} for pr in chat_pairs],
            "residue": residue,
            "console_errors": console_errors,
            "page_errors": page_errors,
            "http_4xx_5xx": http_4xx_5xx,
        }
        REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n===== SUMMARY =====", flush=True)
        for r in results:
            print(f"  {'PASS' if r['ok'] else 'FAIL'} {r['step']} {r['name']}", flush=True)
        print(f"\ncore_pass={core_ok};成功路径={chosen}", flush=True)
        browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
