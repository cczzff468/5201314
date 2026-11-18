# -*- coding: utf-8 -*-
"""
VERIFY-1 补充:真触屏长按路径(touchstart → 按住 600ms → touchend)触发长按菜单
用 CDP Input.dispatchTouchEvent 派发真实触摸事件(右键之外的第二条触发链)。
种子直接带 2 张便签,快速进入留言板。
"""
import json
import pathlib
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
OUT.mkdir(parents=True, exist_ok=True)

console_errors = []
page_errors = []

now = int(time.time() * 1000)
SEED_STATE = {
    "v": 1,
    "accepted": True,
    "anniversary": "2024-05-20",
    "meName": "阿泽",
    "taName": "小鹿",
    "boardBg": 0,
    "boardNotes": [
        {"id": "seed-1", "from": "me", "text": "触屏长按便签甲", "at": now - 3600_000, "comments": []},
        {"id": "seed-2", "from": "me", "text": "触屏长按便签乙", "at": now - 7200_000, "comments": []},
    ],
}

MENU_SEL = '[role="dialog"][aria-label="便签操作"]'
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'


def shot(page, name):
    page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000)
    print(f"    📸 {name}.png", flush=True)


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

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)

        # 种子
        ok = page.evaluate(
            """async (state) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
                });
                await new Promise((res, rej) => {
                    const tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put({ key: 'couple-space:state', value: state });
                    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
                });
                db.close(); return true;
            }""", SEED_STATE)
        assert ok

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)

        # 上滑解锁
        page.mouse.move(195, 790)
        page.mouse.down()
        for y in range(770, 240, -30):
            page.mouse.move(195, y)
            time.sleep(0.02)
        page.mouse.up()
        page.wait_for_selector("text=向上轻扫以解锁", state="detached", timeout=10000)
        time.sleep(0.8)

        # 翻页找恋人空间
        icon = page.locator('[aria-label="打开恋人空间"]')
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
        page.wait_for_selector('[data-testid="couple-home-title"]', timeout=30000)
        page.locator('button:has-text("留言板")').first.click()
        page.wait_for_selector('p:text-is("留言板")', timeout=15000)
        time.sleep(1.0)
        shot(page, "20-touch-board")

        cards = page.eval_on_selector_all(
            CARD_ANY,
            "els => els.map(e => Array.from(e.querySelectorAll('p[class*=\"mt-1.5\"]')).map(p=>p.textContent.trim()).join('|'))")
        print(f"    便签: {cards}", flush=True)
        assert cards == ["触屏长按便签甲", "触屏长按便签乙"], f"种子便签未渲染: {cards}"

        # ---- CDP 触摸长按第一张便签 ----
        box = page.locator(CARD_ANY).first.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        print(f"    touch point: ({cx:.0f},{cy:.0f})", flush=True)
        cdp = ctx.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {
            "type": "touchStart",
            "touchPoints": [{"x": cx, "y": cy, "id": 1}],
        })
        time.sleep(0.7)  # > 480ms 阈值
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        try:
            page.wait_for_selector(MENU_SEL, timeout=5000)
            menu_shown = True
        except Exception:
            menu_shown = False
        time.sleep(0.6)
        shot(page, "21-touch-longpress-menu")
        btns = page.eval_on_selector_all(
            f'{MENU_SEL} button', "els => els.map(e => e.textContent.trim()).filter(Boolean)")
        print(f"    菜单按钮: {btns}", flush=True)
        # 关闭菜单(点取消)
        if menu_shown:
            page.get_by_role("button", name="取消", exact=True).click()
            page.wait_for_selector(MENU_SEL, state="detached", timeout=5000)

        print(f"TOUCH-LONGPRESS {'PASS' if menu_shown and set(['置顶','多选','删除','取消']).issubset(set(btns)) else 'FAIL'}", flush=True)
        print(f"console errors: {len(console_errors)}, page errors: {len(page_errors)}", flush=True)
        for e in console_errors[:10]:
            print("  console.error:", e["text"][:200], flush=True)
        for e in page_errors[:10]:
            print("  pageerror:", e[:200], flush=True)
        browser.close()


if __name__ == "__main__":
    run()
