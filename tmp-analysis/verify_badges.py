# -*- coding: utf-8 -*-
"""小项核验:置顶徽章内含图钉 SVG 图标;多选徽章为圆形(带边框圆元素)"""
import json
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'
now = int(time.time() * 1000)
SEED_STATE = {
    "v": 1, "accepted": True, "anniversary": "2024-05-20",
    "meName": "阿泽", "taName": "小鹿", "boardBg": 0,
    "boardNotes": [
        {"id": "seed-1", "from": "me", "text": "置顶徽章核验", "at": now - 3600_000, "comments": [], "pinned": True},
        {"id": "seed-2", "from": "me", "text": "普通便签", "at": now - 7200_000, "comments": []},
    ],
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
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        reach_board(page)

        # 1) 置顶徽章结构(种子 pinned=True 的便签应排第一且带徽章)
        info = page.eval_on_selector_all(
            CARD_ANY,
            """els => els.map(e => {
                const badge = Array.from(e.querySelectorAll('span')).find(s => s.textContent.trim() === '置顶');
                return {
                    text: Array.from(e.querySelectorAll('p[class*="mt-1.5"]')).map(p=>p.textContent.trim()).join('|'),
                    first: e === els[0],
                    hasPinBadge: !!badge,
                    badgeHasSvg: !!(badge && badge.querySelector('svg')),
                    badgeShape: badge ? getComputedStyle(badge).borderRadius : null,
                };
            })""")
        print(json.dumps(info, ensure_ascii=False), flush=True)

        # 2) 多选徽章圆形
        page.locator(CARD_ANY).first.click(button="right")
        page.wait_for_selector('[role="dialog"][aria-label="便签操作"]', timeout=5000)
        page.get_by_role("button", name="多选", exact=True).click()
        page.wait_for_selector('[role="toolbar"][aria-label="便签多选"]', timeout=5000)
        time.sleep(0.6)
        badges = page.eval_on_selector_all(
            CARD_ANY,
            """els => els.map(e => {
                const b = e.querySelector('span.absolute.right-2.top-2');
                if (!b) return null;
                const cs = getComputedStyle(b);
                return { text: Array.from(e.querySelectorAll('p[class*="mt-1.5"]')).map(p=>p.textContent.trim()).join('|'),
                         borderRadius: cs.borderRadius, w: cs.width, h: cs.height,
                         selected: String(e.className).includes('ring-black'),
                         badgeBg: cs.backgroundColor };
            })""")
        print(json.dumps(badges, ensure_ascii=False), flush=True)
        browser.close()


if __name__ == "__main__":
    run()
