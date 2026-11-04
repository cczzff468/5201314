# -*- coding: utf-8 -*-
"""精确定位:touch 长按后菜单是否被 touchend 合成的 click 立即关闭(时间线)"""
import json
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
MENU_SEL = '[role="dialog"][aria-label="便签操作"]'
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'

now = int(time.time() * 1000)
SEED_STATE = {
    "v": 1, "accepted": True, "anniversary": "2024-05-20",
    "meName": "阿泽", "taName": "小鹿", "boardBg": 0,
    "boardNotes": [{"id": "seed-1", "from": "me", "text": "触屏长按便签甲", "at": now - 3600_000, "comments": []}],
}


def reach_board(page):
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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN",
                                  has_touch=True, is_mobile=True)
        page = ctx.new_page()
        reach_board(page)

        page.evaluate("""() => {
            window.__evts = [];
            const t0 = performance.now();
            for (const t of ['touchstart','touchend','click','contextmenu']) {
                document.addEventListener(t, (e) => {
                    const el = e.target;
                    window.__evts.push([Math.round(performance.now() - t0), t,
                        (el.tagName || '?') + ':' + ((el.getAttribute && el.getAttribute('aria-label')) || '').toString().slice(0, 24)]);
                }, { capture: true, passive: true });
            }
        }""")

        box = page.locator(CARD_ANY).first.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

        cdp = ctx.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy, "id": 1}]})
        # 按住期间轮询菜单是否打开(480ms 阈值)
        t_hold = time.time()
        while time.time() - t_hold < 0.9:
            cnt = page.locator(MENU_SEL).count()
            if cnt:
                print(f"menu opened during hold at {round((time.time()-t_hold)*1000)}ms, count={cnt}", flush=True)
                break
            time.sleep(0.03)
        else:
            print("menu did NOT open during 900ms hold", flush=True)

        timeline = []
        t0 = time.time()
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})  # 抬手
        for _ in range(20):
            timeline.append((round((time.time() - t0) * 1000), page.locator(MENU_SEL).count()))
            time.sleep(0.05)
        evts = page.evaluate("() => window.__evts")
        print("events:", json.dumps(evts, ensure_ascii=False), flush=True)
        print("menu-count timeline (ms, count):", timeline, flush=True)
        browser.close()


if __name__ == "__main__":
    run()
