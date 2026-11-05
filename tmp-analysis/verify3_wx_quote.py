# -*- coding: utf-8 -*-
"""
VERIFY-3: 微信 AI 引用回复([引用:M编号] → wx-quote-block 引用块)端到端验证
流程:解锁 → 微信登录(种子 user 联系人) → 通讯录进 AI 好友聊天 → 连发两条消息 →
     等 AI 回复完 → 查引用块;必要时第二轮;读消息库核对 quote 字段与裸标记残留。
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
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify3-report.json")

CHAR_ID = "c-suqing-v3"
USER_ID = "u-main-v3"
MSG_KEY = f"wx-chat-msgs:{CHAR_ID}"

PERSONA = (
    "你叫苏晴,是阿泽交往两年的女朋友,22 岁,大学生。性格温柔又有点小话痨,喜欢黏着阿泽聊天,"
    "说话口语化、带点撒娇,常用「呀」「啦」「嘛」这类语气词。你聊天时喜欢把对方的话一句一句接住,"
    "认真回应每一句话,不用客套话敷衍。你最近在看一部悬疑电影,还惦记着周末和阿泽出去玩。"
)

results = []
console_errors = []
page_errors = []
chat_api_log = []  # {url, status, req_messages_tail, resp_text}


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    try:
        page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000)
        print(f"    📸 {name}.png", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def unlock_and_open_wechat(page):
    """解锁手机 → 翻页找微信图标 → 打开(出现登录墙)"""
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
    swipes = 0
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
        swipes += 1
        time.sleep(0.7)
    icon.click()
    return swipes


SEED_CONTACTS = [
    {
        "id": USER_ID,
        "kind": "user",
        "ownerId": None,
        "name": "阿泽",
        "nickname": None,
        "gender": "男",
        "age": None,
        "height": None,
        "weight": None,
        "persona": None,
        "background": None,
        "occupation": None,
        "company": None,
        "region": None,
        "relation": None,
        "phone": "13800001234",
        "wechatId": "aze_wx_v3",
        "wechatPassword": "123456",
        "qqId": None,
        "qqPassword": None,
        "avatar": None,
        "isFriend": True,
        "friendWx": True,
        "createdAt": "2025-01-01T00:00:00.000Z",
    },
    {
        "id": CHAR_ID,
        "kind": "char",
        "ownerId": None,
        "name": "苏晴",
        "nickname": None,
        "gender": "女",
        "age": "22",
        "height": None,
        "weight": None,
        "persona": PERSONA,
        "background": None,
        "occupation": "大学生",
        "company": None,
        "region": None,
        "relation": "恋人",
        "phone": "13900005678",
        "wechatId": "suqing_wx_v3",
        "wechatPassword": None,
        "qqId": None,
        "qqPassword": None,
        "avatar": None,
        "isFriend": True,
        "friendWx": True,
        "createdAt": "2025-01-02T00:00:00.000Z",
    },
]


def read_msgs(page):
    """从 IndexedDB kv 读聊天记录(主账号无后缀)"""
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
                id: m.id, role: m.role, kind: m.kind || 'text',
                content: (m.content || '').slice(0, 300),
                quote: m.quote ? { name: m.quote.name, content: (m.quote.content || '').slice(0, 160), id: m.quote.id } : null,
                replyFail: !!m.replyFail,
            }));
        }""",
        MSG_KEY,
    )


def wait_ai_done(page, quiet_ms=6000, timeout_ms=150000):
    """等 AI 回复完毕:typing 指示消失 + 消息条数持续 quiet_ms 无变化"""
    t0 = time.time()
    last_n = -1
    last_change = time.time()
    while time.time() - t0 < timeout_ms / 1000.0:
        typing = page.locator('[data-testid="wx-stream-typing"]').count()
        msgs = page.evaluate(
            """() => document.querySelectorAll('[data-testid="wx-chat-send"]').length"""
        )
        try:
            n = len(read_msgs(page))
        except Exception:
            n = -1
        if typing > 0:
            last_change = time.time()
            last_n = n
        elif n != last_n:
            last_n = n
            last_change = time.time()
        elif time.time() - last_change >= quiet_ms / 1000.0:
            return True, n
        time.sleep(1.0)
    return False, last_n


def check_quotes(page):
    """DOM 引用块 + 消息库 quote 字段 + 裸标记残留"""
    dom_quotes = page.eval_on_selector_all(
        '[data-testid="wx-quote-block"]',
        """els => els.map(e => ({
            text: (e.textContent || '').trim().slice(0, 160),
            cls: e.className.slice(0, 80),
        }))""")
    msgs = read_msgs(page)
    ai = [m for m in msgs if m["role"] == "peer"]
    me = [m for m in msgs if m["role"] == "me"]
    quoted = [m for m in ai if m["quote"]]
    residue = [
        {"role": m["role"], "content": m["content"]}
        for m in msgs
        if re.search(r"\[引用[:：]", m["content"]) or re.search(r"\[M\d+\]", m["content"])
    ]
    return dom_quotes, msgs, me, ai, quoted, residue


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            locale="zh-CN",
            has_touch=True,
            is_mobile=True,
        )
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append({"type": m.type, "text": m.text})
                if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # 抓 /api/chat 请求(内置模型 SDK 兜底链路):记录请求消息数/末条 + 响应全文
        def on_response(resp):
            try:
                if "/api/chat" not in resp.url:
                    return
                req = resp.request
                post = req.post_data or ""
                body = {"url": resp.url, "status": resp.status, "req_bytes": len(post)}
                try:
                    j = json.loads(post)
                    msgs = j.get("messages") or []
                    body["req_msg_count"] = len(msgs)
                    body["req_first_system_head"] = (msgs[0]["content"][:400] if msgs and msgs[0].get("role") == "system" else "")
                    body["req_last_user"] = next((m["content"][:300] for m in reversed(msgs) if m.get("role") == "user"), "")
                    body["forceSdk"] = bool(j.get("forceSdk"))
                except Exception:
                    pass
                try:
                    body["resp_text"] = resp.text()[:2500]
                except Exception:
                    body["resp_text"] = "(读取失败)"
                chat_api_log.append(body)
            except Exception:
                pass

        page.on("response", on_response)

        # ---------- 0. 启动 + 种子 ----------
        print("== Phase 0: boot & seed ==", flush=True)
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        seeded = page.evaluate(
            """async (contacts) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
                });
                const put = (rec) => new Promise((res, rej) => {
                    const tx = db.transaction('contacts', 'readwrite');
                    tx.objectStore('contacts').put(rec);
                    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                });
                for (const c of contacts) await put(c);
                db.close();
                return true;
            }""",
            SEED_CONTACTS,
        )
        log("0", "种子 contacts(user 阿泽 + char 苏晴)", seeded, f"写入 {len(SEED_CONTACTS)} 条联系人记录")

        # 清掉可能残留的旧登录态/消息(全新上下文本就没有,保险)
        page.reload(wait_until="domcontentloaded")
        swipes = unlock_and_open_wechat(page)
        shot(page, "v3-01-wechat-login")
        log("1", "解锁并打开微信(登录墙出现)", True, f"主屏左滑 {swipes} 次找到微信图标;登录页可见")

        # ---------- 2. 登录 ----------
        page.wait_for_selector('[data-testid="wx-login-account"]', timeout=20000)
        page.fill('[data-testid="wx-login-account"]', "13800001234")
        page.fill('[data-testid="wx-login-password"]', "123456")
        page.click('[data-testid="wx-login-submit"]')
        try:
            page.wait_for_selector('[data-testid="wx-tab-chats"]', timeout=20000)
            logged_in = True
        except Exception:
            logged_in = False
        shot(page, "v3-02-wechat-main")
        log("2", "手机号+密码登录微信成功", logged_in, f"四 tab 主界面出现={logged_in}")

        # ---------- 3. 进 AI 好友聊天 ----------
        page.click('[data-testid="wx-tab-contacts"]')
        page.wait_for_selector(f'[data-testid="wx-contact-苏晴"]', timeout=10000)
        page.click(f'[data-testid="wx-contact-苏晴"]')
        page.wait_for_selector('[data-testid="wx-fdetail-chat"]', timeout=10000)
        page.click('[data-testid="wx-fdetail-chat"]')
        page.wait_for_selector('[data-testid="wx-chat-input"]', timeout=15000)
        time.sleep(1.0)
        shot(page, "v3-03-chat-open")
        log("3", "通讯录 → 苏晴 → 发消息 进入聊天页", True, "输入框(wx-chat-input)出现")

        # ---------- 4. Round 1:连发两条 ----------
        print("== Round 1 ==", flush=True)
        page.fill('[data-testid="wx-chat-input"]', "今天中午吃了兰州拉面,特别香")
        page.click('[data-testid="wx-chat-send"]')
        time.sleep(2.0)
        page.fill('[data-testid="wx-chat-input"]', "对了,你上次说的那部电影我想去看")
        page.click('[data-testid="wx-chat-send"]')
        shot(page, "v3-04-two-sent")
        done, n = wait_ai_done(page)
        shot(page, "v3-05-round1-replied")
        dom_quotes, msgs, me_msgs, ai_msgs, quoted, residue = check_quotes(page)
        log("R1", "连发两条 → AI 回复完成", done,
            f"消息总数={len(msgs)}(我方 {len(me_msgs)} / AI {len(ai_msgs)});AI 带引用字段 {len(quoted)} 条;"
            f"DOM 引用块 {len(dom_quotes)} 个")

        if not quoted:
            print("== Round 2(第一轮无引用,再发两条) ==", flush=True)
            page.fill('[data-testid="wx-chat-input"]', "我明天要去上班好烦")
            page.click('[data-testid="wx-chat-send"]')
            time.sleep(2.0)
            page.fill('[data-testid="wx-chat-input"]', "你说我该带伞吗,天气预报有雨")
            page.click('[data-testid="wx-chat-send"]')
            done2, n2 = wait_ai_done(page)
            shot(page, "v3-06-round2-replied")
            dom_quotes, msgs, me_msgs, ai_msgs, quoted, residue = check_quotes(page)
            log("R2", "第二轮连发两条 → AI 回复完成", done2,
                f"消息总数={len(msgs)}(我方 {len(me_msgs)} / AI {len(ai_msgs)});AI 带引用字段 {len(quoted)} 条;"
                f"DOM 引用块 {len(dom_quotes)} 个")

        # ---------- 5. 结论汇总 ----------
        my_texts = [m["content"] for m in me_msgs]
        quote_details = [
            {"ai_text": m["content"], "quote": m["quote"]}
            for m in quoted
        ]
        # 引用内容是否指向用户发的某句话
        pointed = []
        for q in quoted:
            hit = next((t for t in my_texts if t and q["quote"]["content"] and t[:8] in q["quote"]["content"]), None)
            pointed.append({
                "quote_content": q["quote"]["content"],
                "quote_name": q["quote"]["name"],
                "points_to_user_msg": bool(hit),
                "matched_user_msg": (hit or "")[:80],
            })
        core_ok = len(quoted) > 0 and len(dom_quotes) > 0 and any(x["points_to_user_msg"] for x in pointed)
        log("CORE", "至少一条 AI 回复带引用块且指向用户消息",
            core_ok,
            f"AI 回复总数={len(ai_msgs)};带引用={len(quoted)};DOM 引用块={len(dom_quotes)};"
            f"指向用户消息的引用={sum(1 for x in pointed if x['points_to_user_msg'])}")

        log("RESIDUE", "正文无裸 [引用: / [M数字] 残留", len(residue) == 0,
            f"残留条数={len(residue)}" + (f";样例={residue[:3]}" if residue else ""))

        log("CONSOLE", "控制台无 error/pageerror", len(console_errors) == 0 and len(page_errors) == 0,
            f"console error={len(console_errors)} 条;pageerror={len(page_errors)} 条")

        # 最后一张全景截图(滚到底)
        page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('div'));
            const sc = els.filter(e => e.className && String(e.className).includes('overflow-y-auto'));
            sc.forEach(e => { try { e.scrollTop = e.scrollHeight; } catch {} });
        }""")
        time.sleep(0.5)
        shot(page, "v3-07-final-chat")

        summary = {
            "core_pass": core_ok,
            "ai_reply_count": len(ai_msgs),
            "quoted_count": len(quoted),
            "dom_quote_blocks": dom_quotes,
            "quote_details": quote_details,
            "pointed": pointed,
            "residue": residue,
            "my_messages": my_texts,
            "ai_messages": [{"content": m["content"], "quote": m["quote"]} for m in ai_msgs],
            "chat_api_log": chat_api_log,
            "console_errors": console_errors,
            "page_errors": page_errors,
            "results": results,
        }
        REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n===== SUMMARY =====", flush=True)
        print(f"core_pass={core_ok} AI回复={len(ai_msgs)} 带引用={len(quoted)} DOM引用块={len(dom_quotes)}", flush=True)
        print(f"console errors={len(console_errors)} page errors={len(page_errors)} /api/chat 调用={len(chat_api_log)}", flush=True)
        browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
