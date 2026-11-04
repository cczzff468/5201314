# -*- coding: utf-8 -*-
"""调试:CDP 触摸事件是否到达便签卡片/React onTouchStart"""
import pathlib
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
MENU_SEL = '[role="dialog"][aria-label="便签操作"]'
DETAIL_SEL = '[role="dialog"][aria-label="便签详情"]'
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'

now = int(time.time() * 1000)
SEED_STATE = {
    "v": 1, "accepted": True, "anniversary": "2024-05-20",
    "meName": "阿泽", "taName": "小鹿", "boardBg": 0,
    "boardNotes": [
        {"id": "seed-1", "from": "me", "text": "触屏长按便签甲", "at": now - 3600_000, "comments": []},
    ],
}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN",
                                  has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on("console", lambda m: print("  console:", m.type, m.text[:160], flush=True) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: print("  pageerror:", str(e)[:160], flush=True))

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        page.evaluate("""async (state) => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('ios-phone-db');
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            await new Promise((res, rej) => {
                const tx = db.transaction('kv', 'readwrite');
                tx.objectStore('kv').put({ key: 'couple-space:state', value: state });
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
            db.close();
        }""", SEED_STATE)
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

        # 在 document 上监听 touch/click/contextmenu,输出是否命中卡片
        page.evaluate("""() => {
            window.__evts = [];
            for (const t of ['touchstart','touchend','touchmove','click','contextmenu','pointerdown']) {
                document.addEventListener(t, (e) => {
                    const el = e.target;
                    window.__evts.push(t + ':' + (el.tagName || '?') + ':' + (el.getAttribute && el.getAttribute('aria-label') || el.className || '').toString().slice(0, 40));
                }, { capture: true, passive: true });
            }
        }""")

        box = page.locator(CARD_ANY).first.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        print(f"touch at ({cx:.0f},{cy:.0f}), box={box}", flush=True)

        cdp = ctx.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {
            "type": "touchStart",
            "touchPoints": [{"x": cx, "y": cy, "id": 1}],
        })
        time.sleep(0.7)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        time.sleep(0.8)

        evts = page.evaluate("() => window.__evts")
        print("events:", json.dumps(evts, ensure_ascii=False) if (json := __import__('json')) else evts, flush=True)
        print("menu count:", page.locator(MENU_SEL).count(),
              "detail count:", page.locator(DETAIL_SEL).count(), flush=True)
        page.screenshot(path=str(OUT / "22-touch-debug.png"), timeout=15000)
        browser.close()


if __name__ == "__main__":
    run()
